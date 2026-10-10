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
router.post(
  "/auth/register",
  asyncRoute(async (req, res) => {
    const { name, email, password } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100 ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          "Provide a valid name, email, and password of at least 8 characters",
      });
    }

    const count = await db.query(
      "SELECT COUNT(*)::int AS count FROM users"
    );

    if (count.rows[0].count > 0) {
      return res.status(403).json({
        error:
          "Public registration is closed. Ask an administrator to create an account.",
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
  })
);

// Login.
router.post(
  "/auth/login",
  asyncRoute(async (req, res) => {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
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
  })
);

// Get the current user.
router.get(
  "/me",
  authenticate,
  asyncRoute(async (req, res) => {
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
  })
);

// List all users (Admin only).
router.get(
  "/users",
  authenticate,
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const result = await db.query(
      `SELECT id, name, email, role, is_active, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.json({ users: result.rows });
  })
);

// Create a user (Admin only).
router.post(
  "/users",
  authenticate,
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const { name, email, password, role = "team_member" } = req.body;
    const validRoles = [
      "admin",
      "project_manager",
      "team_member",
      "viewer",
    ];

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 100 ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" ||
      password.length < 8 ||
      !validRoles.includes(role)
    ) {
      return res.status(400).json({
        error:
          "Provide a valid name, email, password of at least 8 characters, and role",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existing.rowCount) {
      return res.status(409).json({
        error: "An account with this email already exists",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at`,
      [name.trim(), normalizedEmail, passwordHash, role]
    );

    const user = result.rows[0];

    await db.query(
      `INSERT INTO activity_logs (actor_id, action, details)
       VALUES ($1, 'user.created', $2)`,
      [
        req.user.id,
        JSON.stringify({
          userId: user.id,
          email: user.email,
          role: user.role,
        }),
      ]
    );

    res.status(201).json({ user });
  })
);

// Update a user's name, email, password, role, or active state (Admin only).
router.patch(
  "/users/:userId",
  authenticate,
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const { userId } = req.params;
    const { name, email, password, role, is_active } = req.body;

    const validRoles = [
      "admin",
      "project_manager",
      "team_member",
      "viewer",
    ];

    if (
      name === undefined &&
      email === undefined &&
      password === undefined &&
      role === undefined &&
      is_active === undefined
    ) {
      return res.status(400).json({
        error: "Provide at least one field to update",
      });
    }

    if (
      name !== undefined &&
      (typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 100)
    ) {
      return res.status(400).json({
        error: "Name must be between 1 and 100 characters",
      });
    }

    if (
      email !== undefined &&
      (typeof email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    ) {
      return res.status(400).json({
        error: "A valid email is required",
      });
    }

    if (
      password !== undefined &&
      (typeof password !== "string" || password.length < 8)
    ) {
      return res.status(400).json({
        error: "Password must be at least 8 characters",
      });
    }

    if (role !== undefined && !validRoles.includes(role)) {
      return res.status(400).json({
        error: "Invalid role",
      });
    }

    if (
      is_active !== undefined &&
      typeof is_active !== "boolean"
    ) {
      return res.status(400).json({
        error: "is_active must be true or false",
      });
    }

    const currentResult = await db.query(
      `SELECT id, name, email, role, is_active
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const current = currentResult.rows[0];

    if (!current) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const nextRole = role ?? current.role;
    const nextActive = is_active ?? current.is_active;

    if (
      current.id === req.user.id &&
      (nextRole !== "admin" || nextActive !== true)
    ) {
      return res.status(400).json({
        error:
          "You cannot remove your own administrator role or deactivate your own account",
      });
    }

    // Protect the last active administrator.
    if (
      current.role === "admin" &&
      current.is_active &&
      (nextRole !== "admin" || !nextActive)
    ) {
      const admins = await db.query(
        `SELECT COUNT(*)::int AS count
         FROM users
         WHERE role = 'admin' AND is_active = TRUE`
      );

      if (admins.rows[0].count <= 1) {
        return res.status(409).json({
          error:
            "The last active administrator cannot be demoted or deactivated",
        });
      }
    }

    const nextEmail =
      email === undefined
        ? current.email
        : email.trim().toLowerCase();

    if (email !== undefined) {
      const duplicate = await db.query(
        "SELECT id FROM users WHERE email = $1 AND id <> $2",
        [nextEmail, userId]
      );

      if (duplicate.rowCount) {
        return res.status(409).json({
          error: "An account with this email already exists",
        });
      }
    }

    const passwordHash =
      password === undefined
        ? null
        : await bcrypt.hash(password, 12);

    const result = await db.query(
      `UPDATE users
       SET name = $1,
           email = $2,
           role = $3,
           is_active = $4,
           password_hash = COALESCE($5, password_hash)
       WHERE id = $6
       RETURNING id, name, email, role, is_active, created_at`,
      [
        name === undefined ? current.name : name.trim(),
        nextEmail,
        nextRole,
        nextActive,
        passwordHash,
        userId,
      ]
    );

    const user = result.rows[0];

    await db.query(
      `INSERT INTO activity_logs (actor_id, action, details)
       VALUES ($1, 'user.updated', $2)`,
      [
        req.user.id,
        JSON.stringify({
          userId: user.id,
          changedFields: Object.keys(req.body),
        }),
      ]
    );

    res.json({ user });
  })
);

// List projects accessible to the current user.
router.get(
  "/projects",
  authenticate,
  asyncRoute(async (req, res) => {
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
  })
);

// Create a project.
router.post(
  "/projects",
  authenticate,
  allowRoles("admin", "project_manager"),
  asyncRoute(async (req, res) => {
    const { name, description = "" } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 150 ||
      typeof description !== "string"
    ) {
      return res.status(400).json({
        error: "A project name and valid description are required",
      });
    }

    const result = await db.query(
      `INSERT INTO projects
         (name, description, created_by, manager_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        name.trim(),
        description.trim(),
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

    if (
      typeof title !== "string" ||
      !title.trim() ||
      title.trim().length > 200 ||
      typeof description !== "string"
    ) {
      return res.status(400).json({
        error: "A task title and valid description are required",
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
        description.trim(),
        priority,
        assignee_id,
        req.user.id,
      ]
    );

    const task = result.rows[0];
// Notify the assigned team member.
if (task.assignee_id && task.assignee_id !== req.user.id) {
  const notification = await db.query(
    `INSERT INTO notifications (user_id, message, project_id, task_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, message, project_id, task_id, is_read, created_at`,
    [
      task.assignee_id,
      `You have been assigned a new task: ${task.title}`,
      projectId,
      task.id,
    ]
  );

  req.app
    .get("io")
    ?.to(`user:${task.assignee_id}`)
    .emit("notification:new", {
      notification: notification.rows[0],
    });
}
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
        error:
          "This task changed since you loaded it. Refresh and try again.",
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

    if (
      typeof body !== "string" ||
      !body.trim() ||
      body.trim().length > 2000
    ) {
      return res.status(400).json({
        error: "Comment must contain between 1 and 2000 characters",
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
// Get project activity history.
router.get(
  "/projects/:projectId/activity",
  authenticate,
  asyncRoute(async (req, res) => {
    const { projectId } = req.params;

    if (!(await canAccessProject(req.user, projectId))) {
      return res.status(403).json({
        error: "Project access denied",
      });
    }

    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 30;

    const parsedOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isInteger(parsedOffset)
      ? Math.max(parsedOffset, 0)
      : 0;

    const result = await db.query(
      `SELECT
         al.id,
         al.action,
         al.details,
         al.created_at,
         al.task_id,
         u.name AS actor_name,
         t.title AS task_title
       FROM activity_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       LEFT JOIN tasks t ON t.id = al.task_id
       WHERE al.project_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2 OFFSET $3`,
      [projectId, limit, offset]
    );

    res.json({
      activities: result.rows,
      pagination: {
        limit,
        offset,
        returned: result.rows.length,
      },
    });
  })
);
// Get notifications for the authenticated user.
router.get(
  "/notifications",
  authenticate,
  asyncRoute(async (req, res) => {
    const limitValue = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(limitValue)
      ? Math.min(Math.max(limitValue, 1), 100)
      : 30;

    const offsetValue = Number.parseInt(req.query.offset, 10);
    const offset = Number.isInteger(offsetValue)
      ? Math.max(offsetValue, 0)
      : 0;

    const result = await db.query(
      `SELECT id, message, project_id, task_id, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const unreadResult = await db.query(
      `SELECT COUNT(*)::int AS unread_count
       FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );

    res.json({
      notifications: result.rows,
      unread_count: unreadResult.rows[0].unread_count,
      pagination: {
        limit,
        offset,
        returned: result.rows.length,
      },
    });
  })
);

// Mark one of the authenticated user's notifications as read.
router.patch(
  "/notifications/:notificationId/read",
  authenticate,
  asyncRoute(async (req, res) => {
    const result = await db.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id, message, project_id, task_id, is_read, created_at`,
      [req.params.notificationId, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Notification not found",
      });
    }

    res.json({ notification: result.rows[0] });
  })
);

// List members of a project.
router.get(
  "/projects/:projectId/members",
  authenticate,
  asyncRoute(async (req, res) => {
    const { projectId } = req.params;

    if (!(await canAccessProject(req.user, projectId))) {
      return res.status(403).json({ error: "Project access denied" });
    }

    const result = await db.query(
      `SELECT u.id, u.name, u.email, pm.role, pm.joined_at
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.joined_at ASC`,
      [projectId]
    );

    res.json({ members: result.rows });
  })
);

// Add or update a project member (Admin or project manager).
router.post(
  "/projects/:projectId/members",
  authenticate,
  asyncRoute(async (req, res) => {
    const { projectId } = req.params;
    const { userId, role = "team_member" } = req.body;

    if (!["team_member", "viewer", "project_manager"].includes(role)) {
      return res.status(400).json({ error: "Invalid project role" });
    }

    const access = await db.query(
      `SELECT p.created_by, pm.role AS member_role
       FROM projects p
       LEFT JOIN project_members pm
         ON pm.project_id = p.id AND pm.user_id = $2
       WHERE p.id = $1`,
      [projectId, req.user.id]
    );

    if (!access.rowCount) {
      return res.status(404).json({ error: "Project not found" });
    }

    const isAdmin = req.user.role === "admin";
    const isManager =
      access.rows[0].created_by === req.user.id ||
      access.rows[0].member_role === "project_manager";

    if (!isAdmin && !isManager) {
      return res.status(403).json({ error: "Permission denied" });
    }

    if (typeof userId !== "string") {
      return res.status(400).json({ error: "userId is required" });
    }

    const target = await db.query(
      "SELECT id, is_active FROM users WHERE id = $1",
      [userId]
    );

    if (!target.rowCount || !target.rows[0].is_active) {
      return res.status(404).json({ error: "Active user not found" });
    }

    const result = await db.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id)
       DO UPDATE SET role = EXCLUDED.role
       RETURNING project_id, user_id, role, joined_at`,
      [projectId, userId, role]
    );

    await db.query(
      `INSERT INTO activity_logs (actor_id, project_id, action, details)
       VALUES ($1, $2, 'project.member_added', $3)`,
      [
        req.user.id,
        projectId,
        JSON.stringify({ userId, role }),
      ]
    );

    res.status(200).json({ member: result.rows[0] });
  })
);
module.exports = router;