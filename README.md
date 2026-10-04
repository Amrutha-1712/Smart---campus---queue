# CampusFlow — Smart Campus Queue & Token Management System

CampusFlow is a full-stack web application designed to eliminate physical waiting lines across campus service desks. Students can check service availability, generate virtual queue tokens, and track real-time queue statuses directly from their dashboard.

---

## 🛠 Tech Stack

* **Frontend**: React (Vite), Tailwind CSS, Lucide Icons, Axios, React Router
* **Backend**: Python (Flask), Flask-SQLAlchemy, Flask-JWT-Extended
* **Database**: SQLite
* **Authentication**: JSON Web Tokens (JWT) & Werkzeug Password Hashing

---

## ✨ Key Features

### 🎓 Student Portal
* **Account Registration & Authentication**: Secure user signup and login with JWT session management.
* **Live Service Overview**: View operational campus service desks (Accounts, IT Support, Library, Registrar Office, Student Affairs).
* **Virtual Queue Token Generation**: Select an available campus department to issue an instant queue token.
* **Token Tracking & History**: Monitor active waiting tokens and view resolved service visits.

---

## 🚀 Quick Run Guide

### 1. Backend Setup (Flask API)
```powershell
cd backend
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py