const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const { authenticate, allowRoles } = require("./auth");

const router = express.Router();

function asyncRoute(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

// Register the first account as the administrator.
router.post("/auth/register", asyncRoute(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({
      error: "Name, email and a password of at least 8 characters are required",
    });
  }

  const count = await db.query(
    "SELECT COUNT(*)::int AS count FROM users"
  );

  if (count.rows[0].count > 0) {
    return res.status(403).json({
      error: "Public registration is closed. Ask an administrator to create an account.",
    });
  }

  const hash = await bcrypt.hash(password, 12);

  const result = await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, LOWER($2), $3, 'admin')
     RETURNING id, name, email, role`,
    [name.trim(), email.trim(), hash]
  );

  const user = result.rows[0];

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  res.status(201).json({ user, token });
}));

// Login.
router.post("/auth/login", asyncRoute(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required",
    });
  }

  const result = await db.query(
    `SELECT id, name, email, role, password_hash
     FROM users
     WHERE email = LOWER($1) AND is_active = TRUE`,
    [email.trim()]
  );

  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({
      error: "Invalid email or password",
    });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  delete user.password_hash;

  res.json({ user, token });
}));

// Get the current user.
router.get("/me", authenticate, asyncRoute(async (req, res) => {
  const result = await db.query(
    `SELECT id, name, email, role, is_active
     FROM users
     WHERE id = $1`,
    [req.user.id]
  );

  if (!result.rows[0]?.is_active) {
    return res.status(403).json({
      error: "Account is inactive",
    });
  }

  res.json({ user: result.rows[0] });
}));

// List projects accessible to the current user.
router.get("/projects", authenticate, asyncRoute(async (req, res) => {
  const result = await db.query(
    `SELECT
       p.id,
       p.name,
       p.description,
       p.status,
       p.manager_id,
       p.created_at,
       p.updated_at,
       COUNT(DISTINCT t.id)::int AS task_count,
       COUNT(DISTINCT t.id)
         FILTER (WHERE t.status = 'done')::int AS completed_tasks
     FROM projects p
     LEFT JOIN project_members pm ON pm.project_id = p.id
     LEFT JOIN tasks t ON t.project_id = p.id
     WHERE $1 = 'admin'
        OR p.created_by = $2
        OR pm.user_id = $2
     GROUP BY p.id
     ORDER BY p.updated_at DESC`,
    [req.user.role, req.user.id]
  );

  res.json({ projects: result.rows });
}));

// Create a project.
router.post(
  "/projects",
  authenticate,
  allowRoles("admin", "project_manager"),
  asyncRoute(async (req, res) => {
    const { name, description = "" } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        error: "Project name is required",
      });
    }

    const result = await db.query(
      `INSERT INTO projects
         (name, description, created_by, manager_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        name.trim(),
        description,
        req.user.id,
        req.user.role === "project_manager" ? req.user.id : null,
      ]
    );

    const project = result.rows[0];

    await db.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, 'project_manager')
       ON CONFLICT DO NOTHING`,
      [project.id, req.user.id]
    );

    await db.query(
      `INSERT INTO activity_logs
         (actor_id, project_id, action, details)
       VALUES ($1, $2, 'project.created', $3)`,
      [
        req.user.id,
        project.id,
        JSON.stringify({ name: project.name }),
      ]
    );

    res.status(201).json({ project });
  })
);

// Check project access.
async function canAccessProject(user, projectId) {
  if (user.role === "admin") {
    return true;
  }

  const result = await db.query(
    `SELECT 1
     FROM projects p
     LEFT JOIN project_members pm
       ON pm.project_id = p.id
     WHERE p.id = $1
       AND (p.created_by = $2 OR pm.user_id = $2)
     LIMIT 1`,
    [projectId, user.id]
  );

  return result.rowCount > 0;
}

// List tasks belonging to a project.
router.get(
  "/projects/:projectId/tasks",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!(await canAccessProject(req.user, req.params.projectId))) {
      return res.status(403).json({
        error: "Project access denied",
      });
    }

    const result = await db.query(
      `SELECT t.*, u.name AS assignee_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.project_id = $1
       ORDER BY t.created_at DESC`,
      [req.params.projectId]
    );

    res.json({ tasks: result.rows });
  })
);

// Create a task and broadcast it to connected project members.
router.post(
  "/projects/:projectId/tasks",
  authenticate,
  asyncRoute(async (req, res) => {
    const projectId = req.params.projectId;

    const {
      title,
      description = "",
      priority = "medium",
      assignee_id = null,
    } = req.body;

    if (!(await canAccessProject(req.user, projectId))) {
      return res.status(403).json({
        error: "Project access denied",
      });
    }

    if (!title?.trim()) {
      return res.status(400).json({
        error: "Task title is required",
      });
    }

    if (!["low", "medium", "high"].includes(priority)) {
      return res.status(400).json({
        error: "Invalid priority",
      });
    }

    const membership = await db.query(
      `SELECT role
       FROM project_members
       WHERE project_id = $1 AND user_id = $2`,
      [projectId, req.user.id]
    );

    const isCreator = await db.query(
      `SELECT 1
       FROM projects
       WHERE id = $1 AND created_by = $2`,
      [projectId, req.user.id]
    );

    const canManage =
      req.user.role === "admin" ||
      membership.rows[0]?.role === "project_manager" ||
      isCreator.rowCount > 0;

    if (!canManage) {
      return res.status(403).json({
        error: "Only project managers can create tasks",
      });
    }

    if (assignee_id) {
      const member = await db.query(
        `SELECT 1
         FROM project_members
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, assignee_id]
      );

      if (!member.rowCount) {
        return res.status(400).json({
          error: "Assignee must be a project member",
        });
      }
    }

    const result = await db.query(
      `INSERT INTO tasks
         (project_id, title, description, priority, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        projectId,
        title.trim(),
        description,
        priority,
        assignee_id,
        req.user.id,
      ]
    );

    const task = result.rows[0];

    await db.query(
      `INSERT INTO activity_logs
         (actor_id, project_id, task_id, action, details)
       VALUES ($1, $2, $3, 'task.created', $4)`,
      [
        req.user.id,
        projectId,
        task.id,
        JSON.stringify({ title: task.title }),
      ]
    );

    // NEW: notify connected users that a task was created.
    req.app
      .get("io")
      ?.to(`project:${projectId}`)
      .emit("task:created", { task });

    res.status(201).json({ task });
  })
);

// Update task status using optimistic concurrency control.
router.patch(
  "/tasks/:taskId/status",
  authenticate,
  asyncRoute(async (req, res) => {
    const { status, version } = req.body;

    if (
      !["todo", "in_progress", "done"].includes(status) ||
      !Number.isInteger(version)
    ) {
      return res.status(400).json({
        error: "Valid status and current version are required",
      });
    }

    const found = await db.query(
      "SELECT * FROM tasks WHERE id = $1",
      [req.params.taskId]
    );

    const current = found.rows[0];

    if (!current) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    if (!(await canAccessProject(req.user, current.project_id))) {
      return res.status(403).json({
        error: "Project access denied",
      });
    }

    const membership = await db.query(
      `SELECT role
       FROM project_members
       WHERE project_id = $1 AND user_id = $2`,
      [current.project_id, req.user.id]
    );

    const isCreator = await db.query(
      `SELECT 1
       FROM projects
       WHERE id = $1 AND created_by = $2`,
      [current.project_id, req.user.id]
    );

    const canManage =
      req.user.role === "admin" ||
      membership.rows[0]?.role === "project_manager" ||
      isCreator.rowCount > 0;

    if (!canManage && current.assignee_id !== req.user.id) {
      return res.status(403).json({
        error: "Only the assignee or project manager can update this task",
      });
    }

    const updated = await db.query(
      `UPDATE tasks
       SET status = $1,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $2 AND version = $3
       RETURNING *`,
      [status, current.id, version]
    );

    if (!updated.rowCount) {
      return res.status(409).json({
        error: "This task changed since you loaded it. Refresh and try again.",
      });
    }

    const task = updated.rows[0];

    await db.query(
      `INSERT INTO activity_logs
         (actor_id, project_id, task_id, action, details)
       VALUES ($1, $2, $3, 'task.status_changed', $4)`,
      [
        req.user.id,
        task.project_id,
        task.id,
        JSON.stringify({ status, version: task.version }),
      ]
    );

    req.app
      .get("io")
      ?.to(`project:${task.project_id}`)
      .emit("task:updated", { task });

    res.json({ task });
  })
);

// Get comments for a task.
router.get(
  "/tasks/:taskId/comments",
  authenticate,
  asyncRoute(async (req, res) => {
    const task = await db.query(
      "SELECT * FROM tasks WHERE id = $1",
      [req.params.taskId]
    );

    if (!task.rows[0]) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    if (!(await canAccessProject(req.user, task.rows[0].project_id))) {
      return res.status(403).json({
        error: "Project access denied",
      });
    }

    const result = await db.query(
      `SELECT c.id, c.body, c.created_at, u.name AS author
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.task_id = $1
       ORDER BY c.created_at`,
      [req.params.taskId]
    );

    res.json({ comments: result.rows });
  })
);

// Add a comment and broadcast it to connected project members.
router.post(
  "/tasks/:taskId/comments",
  authenticate,
  asyncRoute(async (req, res) => {
    const { body } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({
        error: "Comment cannot be empty",
      });
    }

    const taskResult = await db.query(
      "SELECT * FROM tasks WHERE id = $1",
      [req.params.taskId]
    );

    const task = taskResult.rows[0];

    if (!task) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    if (!(await canAccessProject(req.user, task.project_id))) {
      return res.status(403).json({
        error: "Project access denied",
      });
    }

    const result = await db.query(
      `INSERT INTO comments (task_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, user_id, body, created_at`,
      [task.id, req.user.id, body.trim()]
    );

    const comment = result.rows[0];

    await db.query(
      `INSERT INTO activity_logs
         (actor_id, project_id, task_id, action, details)
       VALUES ($1, $2, $3, 'comment.created', $4)`,
      [
        req.user.id,
        task.project_id,
        task.id,
        JSON.stringify({ commentId: comment.id }),
      ]
    );

    req.app
      .get("io")
      ?.to(`project:${task.project_id}`)
      .emit("comment:created", { comment });

    res.status(201).json({ comment });
  })
);

module.exports = router;