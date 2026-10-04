import json
import os
import re
import time
from datetime import timedelta
from pathlib import Path

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
    verify_jwt_in_request,
)
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.security import generate_password_hash

from .auth import auth_bp, current_user, register_jwt_callbacks, require_roles
from .models import Department, RevokedToken, Token, User, db, utcnow


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///campus_queue.db")
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def _error(message: str, status: int):
    return jsonify(error=message), status


def _active_queue(department_id: int):
    return (
        Token.query.filter(
            Token.department_id == department_id,
            Token.status.in_(("waiting", "in_progress")),
        )
        .order_by(Token.created_at.asc(), Token.id.asc())
        .all()
    )


def _student_token_dict(token: Token) -> dict:
    result = token.to_dict()
    if token.status == "in_progress":
        result.update(position=0, people_ahead=0, estimated_wait_minutes=0)
        return result
    if token.status != "waiting":
        result.update(position=None, people_ahead=None, estimated_wait_minutes=None)
        return result

    active = _active_queue(token.department_id)
    ahead = 0
    waiting_ahead = 0
    for item in active:
        if item.id == token.id:
            break
        ahead += 1
        if item.status == "waiting":
            waiting_ahead += 1
    result.update(
        position=waiting_ahead + 1,
        people_ahead=ahead,
        estimated_wait_minutes=ahead * token.department.estimated_service_minutes,
    )
    return result


def _queue_state() -> dict:
    departments = Department.query.filter_by(is_active=True).order_by(Department.name).all()
    all_tokens = (
        Token.query.join(Department)
        .filter(
            Department.is_active.is_(True),
            Token.status.in_(("waiting", "in_progress")),
        )
        .order_by(Token.department_id.asc(), Token.created_at.asc(), Token.id.asc())
        .all()
    )
    tokens_by_department: dict[int, list[dict]] = {}
    for token in all_tokens:
        tokens_by_department.setdefault(token.department_id, []).append(
            {
                "id": token.id,
                "token_number": token.token_number,
                "status": token.status,
            }
        )
    return {
        "departments": [
            {
                **department.to_dict(),
                "tokens": tokens_by_department.get(department.id, []),
                "waiting_count": sum(
                    token["status"] == "waiting"
                    for token in tokens_by_department.get(department.id, [])
                ),
            }
            for department in departments
        ],
    }


def _set_token_status(token: Token, status: str):
    now = utcnow()
    token.status = status
    token.updated_at = now
    if status == "in_progress":
        token.called_at = now
    elif status in {"resolved", "no_show", "cancelled"}:
        token.resolved_at = now


def _validate_department_payload(payload: dict):
    name = " ".join(str(payload.get("name", "")).split())
    prefix = str(payload.get("prefix", "")).strip().upper()
    minutes = payload.get("estimated_service_minutes", 5)
    if not name or len(name) > 100:
        return None, "Department name must be between 1 and 100 characters."
    if not re.fullmatch(r"[A-Z0-9]{2,8}", prefix):
        return None, "Prefix must contain 2–8 letters or numbers."
    if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= 240:
        return None, "Estimated service time must be a whole number between 1 and 240."
    return {
        "name": name,
        "prefix": prefix,
        "estimated_service_minutes": minutes,
    }, None


def _bootstrap_admin(app: Flask):
    email = app.config.get("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    password = app.config.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not email and not password:
        return
    if not email or len(password) < 12:
        raise RuntimeError(
            "Set both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD "
            "(the password must be at least 12 characters)."
        )
    user = User.query.filter_by(email=email).first()
    if user is None:
        db.session.add(
            User(
                email=email,
                full_name="Campus Administrator",
                password_hash=generate_password_hash(password),
                role="admin",
            )
        )
        db.session.commit()
    elif user.role != "admin":
        raise RuntimeError(
            "The configured bootstrap admin email belongs to a non-admin account. "
            "Choose a separate BOOTSTRAP_ADMIN_EMAIL."
        )


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI=_database_url(),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY=os.environ.get("JWT_SECRET_KEY") or os.environ.get("SECRET_KEY"),
        JWT_ACCESS_TOKEN_EXPIRES=timedelta(hours=8),
        JWT_TOKEN_LOCATION=["headers"],
        JWT_QUERY_STRING_NAME="ticket",
        BOOTSTRAP_ADMIN_EMAIL=os.environ.get("BOOTSTRAP_ADMIN_EMAIL", ""),
        BOOTSTRAP_ADMIN_PASSWORD=os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", ""),
    )
    if test_config:
        app.config.update(test_config)
    if not app.config.get("JWT_SECRET_KEY"):
        raise RuntimeError(
            "Set JWT_SECRET_KEY to a strong, randomly generated secret before starting."
        )

    db.init_app(app)
    jwt_manager = JWTManager(app)
    register_jwt_callbacks(jwt_manager)
    origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    CORS(app, resources={r"/api/*": {"origins": [item.strip() for item in origins.split(",") if item.strip()]}})
    app.register_blueprint(auth_bp)

    @app.get("/api/health")
    def health():
        return jsonify(status="ok")

    @app.get("/api/departments")
    def get_departments():
        departments = Department.query.filter_by(is_active=True).order_by(Department.name).all()
        return jsonify(departments=[department.to_dict() for department in departments])

    @app.post("/api/tokens")
    @jwt_required()
    @require_roles("student")
    def create_token():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("A JSON request body is required.", 400)
        try:
            department_id = int(payload.get("department_id"))

        except (TypeError, ValueError):
            return _error("Choose a valid department.", 400)
        department = db.session.get(Department, department_id)
        if department is None or not department.is_active:
            return _error("That department is not available.", 404)

        user = current_user()
        if (
            Token.query.filter(
                Token.user_id == user.id,
                Token.department_id == department_id,
                Token.status.in_(("waiting", "in_progress")),
            ).first()
        ):
            return _error("You already have an active token for this department.", 409)

        try:
            token = Token(
                token_number=None,
                department_id=department_id,
                user_id=user.id,
                status="waiting",
            )
            db.session.add(token)
            db.session.flush()
            token.token_number = f"{department.prefix}-{token.id + 100}"
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return _error("You already have an active token for this department.", 409)
        except SQLAlchemyError:
            db.session.rollback()
            app.logger.exception("Unable to issue a queue token.")
            return _error("The token could not be created. Please try again.", 500)
        return jsonify(token=_student_token_dict(token)), 201

    @app.get("/api/tokens/mine")
    @jwt_required()
    @require_roles("student")
    def get_my_tokens():
        user = current_user()
        tokens = (
            Token.query.filter_by(user_id=user.id)
            .order_by(Token.created_at.desc(), Token.id.desc())
            .all()
        )
        return jsonify(tokens=[_student_token_dict(token) for token in tokens])

    @app.delete("/api/tokens/<int:token_id>")
    @jwt_required()
    @require_roles("student")
    def cancel_token(token_id: int):
        user = current_user()
        token = db.session.get(Token, token_id)
        if token is None or token.user_id != user.id:
            return _error("Token not found.", 404)
        if token.status != "waiting":
            return _error("Only a token that is waiting can be cancelled.", 409)
        _set_token_status(token, "cancelled")
        db.session.commit()
        return jsonify(token=_student_token_dict(token))

    @app.get("/api/queue/state")
    @jwt_required()
    def get_queue_state():
        return jsonify(_queue_state())

    @app.post("/api/queue/stream-ticket")
    @jwt_required()
    def create_stream_ticket():
        user = current_user()
        if user is None:
            return _error("Your account is unavailable.", 401)
        ticket = create_access_token(
            identity=str(user.id),
            additional_claims={
                "stream_only": True,
                "role": user.role,
                "session_jti": get_jwt()["jti"],
                "session_exp": get_jwt()["exp"],
            },
            expires_delta=timedelta(minutes=3),
        )
        return jsonify(ticket=ticket)

    @app.get("/api/queue/stream")
    def queue_stream():
        verify_jwt_in_request(locations=["query_string"])
        claims = get_jwt()
        if not claims.get("stream_only"):
            return _error("A queue stream ticket is required.", 401)
        user_id = get_jwt_identity()
        session_jti = claims.get("session_jti")
        session_exp = claims.get("session_exp")
        try:
            user = db.session.get(User, int(user_id))
        except (TypeError, ValueError):
            user = None
        if user is None or not user.is_active:
            return _error("Your account is unavailable.", 401)

        @stream_with_context
        def generate():
            previous = None
            heartbeat_at = time.monotonic()
            while True:
                revoked = db.session.get(RevokedToken, session_jti) is not None
                stream_user = db.session.get(User, int(user_id))
                if (
                    revoked
                    or stream_user is None
                    or not stream_user.is_active
                    or not isinstance(session_exp, (int, float))
                    or time.time() >= session_exp
                ):
                    db.session.rollback()
                    break
                snapshot = _queue_state()
                serialized = json.dumps(snapshot, separators=(",", ":"), sort_keys=True)
                db.session.rollback()
                if serialized != previous:
                    yield f"data: {serialized}\n\n"
                    previous = serialized
                    heartbeat_at = time.monotonic()
                elif time.monotonic() - heartbeat_at >= 15:
                    yield ": keepalive\n\n"
                    heartbeat_at = time.monotonic()
                time.sleep(1)

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.get("/api/staff/queue")
    @jwt_required()
    @require_roles("staff")
    def get_staff_queue():
        user = current_user()
        if user.department_id is None:
            return _error("Your account is not assigned to a department.", 409)
        department = db.session.get(Department, user.department_id)
        if department is None or not department.is_active:
            return _error("Your assigned department is not available.", 409)
        tokens = _active_queue(department.id)
        return jsonify(
            department=department.to_dict(),
            tokens=[token.to_dict() for token in tokens],
        )

    @app.post("/api/staff/queue/next")
    @jwt_required()
    @require_roles("staff")
    def call_next_token():
        user = current_user()
        if user.department_id is None:
            return _error("Your account is not assigned to a department.", 409)
        department = db.session.get(Department, user.department_id)
        if department is None or not department.is_active:
            return _error("Your assigned department is not available.", 409)
        if Token.query.filter_by(department_id=department.id, status="in_progress").first():
            return _error("Resolve the in-progress token before calling another.", 409)
        token = (
            Token.query.filter_by(department_id=department.id, status="waiting")
            .order_by(Token.created_at.asc(), Token.id.asc())
            .with_for_update()
            .first()
        )
        if token is None:
            return _error("There are no tokens waiting in this queue.", 404)
        _set_token_status(token, "in_progress")
        db.session.commit()
        return jsonify(token=token.to_dict())

    @app.patch("/api/staff/tokens/<int:token_id>")
    @jwt_required()
    @require_roles("staff")
    def update_staff_token(token_id: int):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("A JSON request body is required.", 400)
        status = payload.get("status")
        if status not in {"resolved", "no_show"}:
            return _error("Status must be resolved or no_show.", 400)
        user = current_user()
        token = db.session.get(Token, token_id)
        if (
            token is None
            or user.department_id is None
            or token.department_id != user.department_id
        ):
            return _error("Token not found in your department.", 404)
        if token.status != "in_progress":
            return _error("Only an in-progress token can be completed.", 409)
        _set_token_status(token, status)
        db.session.commit()
        return jsonify(token=token.to_dict())

    @app.get("/api/admin/metrics")
    @jwt_required()
    @require_roles("admin")
    def get_admin_metrics():
        now = utcnow()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        total_today = Token.query.filter(Token.created_at >= start_of_day).count()
        active_queues = (
            db.session.query(func.count(func.distinct(Token.department_id)))
            .join(Department, Department.id == Token.department_id)
            .filter(
                Department.is_active.is_(True),
                Token.status.in_(("waiting", "in_progress")),
            )
            .scalar()
            or 0
        )
        completed_today = Token.query.filter(
            Token.called_at.is_not(None),
            Token.called_at >= start_of_day,
        ).all()
        wait_times = [
            max(0, (token.called_at - token.created_at).total_seconds() / 60)
            for token in completed_today
        ]
        average_wait = sum(wait_times) / len(wait_times) if wait_times else 0
        return jsonify(
            total_tokens_today=total_today,
            active_queues=active_queues,
            average_wait_minutes=round(average_wait, 1),
            departments=Department.query.filter_by(is_active=True).count(),
        )

    @app.get("/api/admin/departments")
    @jwt_required()
    @require_roles("admin")
    def list_admin_departments():
        departments = Department.query.order_by(Department.name).all()
        return jsonify(departments=[department.to_dict(include_inactive=True) for department in departments])

    @app.post("/api/admin/departments")
    @jwt_required()
    @require_roles("admin")
    def add_department():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("A JSON request body is required.", 400)
        details, error = _validate_department_payload(payload)
        if error:
            return _error(error, 400)
        department = Department(**details)
        db.session.add(department)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return _error("A department with that name or prefix already exists.", 409)
        return jsonify(department=department.to_dict(include_inactive=True)), 201

    @app.delete("/api/admin/departments/<int:department_id>")
    @jwt_required()
    @require_roles("admin")
    def remove_department(department_id: int):
        department = db.session.get(Department, department_id)
        if department is None or not department.is_active:
            return _error("Department not found.", 404)
        if Token.query.filter(
            Token.department_id == department.id,
            Token.status.in_(("waiting", "in_progress")),
        ).first():
            return _error("Resolve or cancel this department's active tokens before removing it.", 409)
        department.is_active = False
        for staff_user in department.staff:
            staff_user.department_id = None
        db.session.commit()
        return jsonify(department=department.to_dict(include_inactive=True))

    @app.get("/api/admin/users")
    @jwt_required()
    @require_roles("admin")
    def list_admin_users():
        try:
            page = max(1, int(request.args.get("page", "1")))
            per_page = min(100, max(1, int(request.args.get("per_page", "25"))))
        except ValueError:
            return _error("Page and per_page must be whole numbers.", 400)
        pagination = User.query.order_by(User.created_at.desc(), User.id.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )
        return jsonify(
            users=[user.to_dict() for user in pagination.items],
            page=pagination.page,
            pages=pagination.pages,
            total=pagination.total,
        )

    @app.patch("/api/admin/users/<int:user_id>")
    @jwt_required()
    @require_roles("admin")
    def update_user_role(user_id: int):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return _error("A JSON request body is required.", 400)
        role = payload.get("role")
        if role not in {"student", "staff", "admin"}:
            return _error("Choose a valid user role.", 400)
        actor = current_user()
        target = db.session.get(User, user_id)
        if target is None:
            return _error("User not found.", 404)
        if actor.id == target.id and role != "admin":
            return _error("You cannot remove your own administrator access.", 409)

        department_id = payload.get("department_id")
        department = None
        if role == "staff":
            try:
                department_id = int(department_id)
            except (TypeError, ValueError):
                return _error("Choose a department for staff members.", 400)
            department = db.session.get(Department, department_id)
            if department is None or not department.is_active:
                return _error("Choose an active department for this staff member.", 400)
        else:
            department_id = None

        if target.role == "admin" and role != "admin":
            other_admins = User.query.filter_by(role="admin", is_active=True).count()
            if other_admins <= 1:
                return _error("The last active administrator cannot be demoted.", 409)
        target.role = role
        target.department_id = department_id
        db.session.commit()
        return jsonify(user=target.to_dict())

    @app.errorhandler(IntegrityError)
    def handle_integrity_error(_error):
        db.session.rollback()
        return _error("The requested change conflicts with existing data.", 409)

    @app.errorhandler(SQLAlchemyError)
    def handle_database_error(error):
        db.session.rollback()
        app.logger.exception("Database operation failed: %s", error)
        return _error("A database error prevented the request from completing.", 500)

    with app.app_context():
        db.create_all()
        if Department.query.first() is None:
            db.session.add_all(
                [
                    Department(name="Registrar Office", prefix="REG"),
                    Department(name="Library", prefix="LIB"),
                    Department(name="Accounts", prefix="ACC"),
                    Department(name="Student Affairs", prefix="SA"),
                    Department(name="IT Support", prefix="IT"),
                ]
            )
            db.session.commit()
        _bootstrap_admin(app)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), threaded=True)
