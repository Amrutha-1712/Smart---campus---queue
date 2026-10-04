import re
from functools import wraps

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy import select
from werkzeug.security import check_password_hash, generate_password_hash

from models import Department, RevokedToken, User, db, utcnow

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def current_user() -> User | None:
    try:
        user_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return None
    user = db.session.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return user


def require_roles(*roles):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = current_user()
            if user is None:
                return jsonify(error="Your account is unavailable."), 401
            if user.role not in roles:
                return jsonify(error="You do not have permission to perform this action."), 403
            return view(*args, **kwargs)

        return wrapped

    return decorator


def register_jwt_callbacks(jwt_manager):
    @jwt_manager.token_in_blocklist_loader
    def token_is_revoked(_jwt_header, jwt_payload):
        return db.session.execute(
            select(RevokedToken.jti).where(RevokedToken.jti == jwt_payload["jti"])
        ).scalar_one_or_none() is not None

    @jwt_manager.unauthorized_loader
    def missing_token(reason):
        return jsonify(error=reason), 401

    @jwt_manager.invalid_token_loader
    def invalid_token(reason):
        return jsonify(error=reason), 401

    @jwt_manager.expired_token_loader
    def expired_token(_jwt_header, _jwt_payload):
        return jsonify(error="Your session has expired. Please sign in again."), 401

    @jwt_manager.revoked_token_loader
    def revoked_token(_jwt_header, _jwt_payload):
        return jsonify(error="This session has been signed out."), 401


@auth_bp.post("/register")
def register():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="A JSON request body is required."), 400

    email = str(payload.get("email", "")).strip().lower()
    full_name = " ".join(str(payload.get("full_name", "")).split())
    password = payload.get("password")
    role = payload.get("role", "student")
    if not EMAIL_PATTERN.fullmatch(email):
        return jsonify(error="Enter a valid email address."), 400
    if not full_name or len(full_name) > 120:
        return jsonify(error="Your name must be between 1 and 120 characters."), 400
    if not isinstance(password, str) or len(password) < 10 or len(password) > 256:
        return jsonify(error="Your password must be at least 10 characters."), 400
    if not isinstance(role, str) or role not in {"student", "staff"}:
        return jsonify(error="Choose student or staff as your account role."), 400

    department = None
    if role == "staff":
        try:
            raw_department_id = payload.get("department_id")
            if isinstance(raw_department_id, bool):
                raise ValueError
            department_id = int(raw_department_id)
        except (TypeError, ValueError):
            return jsonify(error="Choose a department for your staff account."), 400
        department = db.session.get(Department, department_id)
        if department is None or not department.is_active:
            return jsonify(error="Choose an active department for your staff account."), 400
    if User.query.filter_by(email=email).first():
        return jsonify(error="An account with that email already exists."), 409

    user = User(
        email=email,
        full_name=full_name,
        password_hash=generate_password_hash(password),
        role=role,
        department_id=department.id if department else None,
    )
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error="An account with that email already exists."), 409
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception("Unable to create a user account.")
        return jsonify(error="The account could not be created. Please try again."), 500

    access_token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    return jsonify(access_token=access_token, user=user.to_dict()), 201


@auth_bp.post("/login")
def login():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="A JSON request body is required."), 400

    email = str(payload.get("email", "")).strip().lower()
    password = payload.get("password")
    user = User.query.filter_by(email=email).first()
    if (
        user is None
        or not user.is_active
        or not isinstance(password, str)
        or not check_password_hash(user.password_hash, password)
    ):
        return jsonify(error="The email or password is incorrect."), 401

    access_token = create_access_token(identity=str(user.id), additional_claims={"role": user.role})
    return jsonify(access_token=access_token, user=user.to_dict())


@auth_bp.post("/logout")
@jwt_required()
def logout():
    token_id = get_jwt()["jti"]
    db.session.add(RevokedToken(jti=token_id, revoked_at=utcnow()))
    db.session.commit()
    return jsonify(message="You have been signed out.")


@auth_bp.get("/me")
@jwt_required()
def get_me():
    user = current_user()
    if user is None:
        return jsonify(error="Your account is unavailable."), 401
    return jsonify(user=user.to_dict())
