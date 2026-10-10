
# NeoStats — Collaborative Project Management Platform

NeoStats is a collaborative project management platform designed to help teams organize projects, manage tasks, assign responsibilities, and track progress from a shared workspace.

The platform uses an administrator-controlled access model to manage team accounts, project membership, and task assignments.

## Key Features

- **Role-Based Access:** Separate administrator and team-member roles.
- **User Management:** Administrators can create team-member accounts.
- **Project Management:** Create and manage collaborative projects.
- **Project Membership:** Add authorized team members to specific projects.
- **Task Management:** Create tasks with descriptions, priorities, and statuses.
- **Task Assignment:** Assign tasks to members of the relevant project.
- **Progress Tracking:** Monitor completed, in-progress, and pending tasks.
- **Real-Time Updates:** Socket.IO supports live task-board events.
- **Authentication:** JWT-based authentication and password hashing with bcryptjs.
- **Project-Level Access:** Designed to restrict users to projects they are authorized to access.

## Technology Stack

| Technology | Purpose |
|---|---|
| Next.js | Frontend framework |
| React | Interactive user interface |
| TypeScript | Type-safe frontend development |
| Tailwind CSS | Styling and responsive layouts |
| Node.js | Backend runtime |
| Express.js | REST API |
| PostgreSQL | Relational database |
| Socket.IO | Real-time communication |
| JSON Web Token (JWT) | Authentication |
| bcryptjs | Password hashing |

## Architecture

```text
User
  |
  v
Next.js + React Frontend
  |
  | HTTP API Requests
  v
Node.js + Express Backend
  |
  +---- JWT Authentication
  |
  +---- Authorization Checks
  |
  +---- PostgreSQL Database
  |
  +---- Socket.IO Events
```

## User Workflow

1. The administrator logs in.
2. The administrator creates a team-member account.
3. The administrator adds the member to a project.
4. The administrator creates and assigns a task.
5. The team member logs in and views their authorized project and assigned task.
6. Team members can work with their tasks according to their permissions.

## Project Structure

```text
neostats-collab/
├── frontend/
│   └── app/ or src/app/
├── backend/
│   ├── server.js
│   ├── routes/
│   └── middleware/
├── README.md
└── .gitignore
```

The exact directory structure may vary depending on the current project setup.

## Getting Started

### Prerequisites

- Node.js and npm
- PostgreSQL
- Git

### 1. Clone the repository

```bash
git clone https://github.com/Raju-CS8/Collaborative-Project-Management-Platform.git
cd Collaborative-Project-Management-Platform
```

### 2. Configure the backend

Navigate to the backend directory and install dependencies:

```bash
cd backend
npm install
```

Configure the required environment variables in your backend `.env` file, including the database connection and authentication settings.

### 3. Configure the database

Create the PostgreSQL database and apply the project's existing schema and migrations.

Ensure that the backend is configured to connect to the correct database.

### 4. Start the backend

Use the backend start script defined in `backend/package.json`. For example:

```bash
npm run dev
```

### 5. Start the frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by the frontend development server, typically:

http://localhost:3000

> Follow the scripts and configuration in your actual package.json files if they differ from these examples.

## Security Considerations

- Protect administrator-only endpoints with backend authorization.
- Do not allow public registration to grant administrator privileges.
- Validate project membership before task assignment.
- Store password hashes rather than plain-text passwords.
- Keep `.env` files and secrets out of version control.
- Enforce project-level authorization on backend API requests.

## Current Development Status

The following workflows have been demonstrated through the backend API and application UI:

- Administrator login
- Team-member account creation through the admin API
- Team-member login
- Adding a member to a project
- Assigning a task to a project member
- Viewing the assigned task from the member dashboard

Dedicated administrator dashboard controls for user creation, user search, project membership, and task assignment still require implementation and verification.

Comprehensive authorization testing and full real-time workflow testing are also pending.

## Future Improvements

- Complete the administrator management interface
- Add user search and project-member selection
- Add task assignment controls to the dashboard
- Expand access-control testing
- Improve notification and activity-history workflows
- Add automated tests and deployment configuration

## Author

Developed as a collaborative project management platform for the NeoStats hackathon.
