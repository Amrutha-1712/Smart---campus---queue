from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

db = SQLAlchemy()


def utcnow() -> datetime:
    return datetime.utcnow()


class User(db.Model):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(db.String(320), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(db.String(120))
    password_hash: Mapped[str] = mapped_column(db.String(256))
    role: Mapped[str] = mapped_column(db.String(16), default="student", index=True)
    department_id: Mapped[int | None] = mapped_column(
        db.ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(db.Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, default=utcnow, nullable=False)

    department: Mapped["Department | None"] = relationship(back_populates="staff")
    tokens: Mapped[list["Token"]] = relationship(back_populates="student")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "full_name": self.full_name,
            "role": self.role,
            "department_id": self.department_id,
            "department_name": self.department.name if self.department else None,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() + "Z",
        }


class Department(db.Model):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(db.String(100), unique=True)
    prefix: Mapped[str] = mapped_column(db.String(8), unique=True)
    estimated_service_minutes: Mapped[int] = mapped_column(db.Integer, default=5)
    is_active: Mapped[bool] = mapped_column(db.Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, default=utcnow, nullable=False)

    staff: Mapped[list[User]] = relationship(back_populates="department")
    tokens: Mapped[list["Token"]] = relationship(back_populates="department")

    def to_dict(self, include_inactive: bool = False) -> dict:
        result = {
            "id": self.id,
            "name": self.name,
            "prefix": self.prefix,
            "estimated_service_minutes": self.estimated_service_minutes,
            "is_active": self.is_active,
        }
        if include_inactive:
            result["created_at"] = self.created_at.isoformat() + "Z"
        return result


class Token(db.Model):
    __tablename__ = "tokens"
    __table_args__ = (
        Index("ix_tokens_department_status_created", "department_id", "status", "created_at"),
        Index("ix_tokens_user_created", "user_id", "created_at"),
        Index(
            "uq_tokens_one_active_student_department",
            "user_id",
            "department_id",
            unique=True,
            sqlite_where=text("status IN ('waiting', 'in_progress')"),
            postgresql_where=text("status IN ('waiting', 'in_progress')"),
        ),
        Index(
            "uq_tokens_one_in_progress_per_department",
            "department_id",
            unique=True,
            sqlite_where=text("status = 'in_progress'"),
            postgresql_where=text("status = 'in_progress'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    token_number: Mapped[str | None] = mapped_column(
        db.String(24), unique=True, index=True, nullable=True
    )
    department_id: Mapped[int] = mapped_column(
        db.ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    user_id: Mapped[int] = mapped_column(
        db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(db.String(16), default="waiting", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, default=utcnow, nullable=False)
    called_at: Mapped[datetime | None] = mapped_column(db.DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(db.DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        db.DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    department: Mapped[Department] = relationship(back_populates="tokens")
    student: Mapped[User] = relationship(back_populates="tokens")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "token_number": self.token_number,
            "department_id": self.department_id,
            "department_name": self.department.name,
            "department_prefix": self.department.prefix,
            "user_id": self.user_id,
            "student_name": self.student.full_name,
            "status": self.status,
            "created_at": self.created_at.isoformat() + "Z",
            "called_at": self.called_at.isoformat() + "Z" if self.called_at else None,
            "resolved_at": self.resolved_at.isoformat() + "Z" if self.resolved_at else None,
        }


class RevokedToken(db.Model):
    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(db.String(36), primary_key=True)
    revoked_at: Mapped[datetime] = mapped_column(db.DateTime, default=utcnow, nullable=False)
