
const jwt = require("jsonwebtoken");
const db = require("./db");

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: payload.id,
      role: payload.role,
    };

    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function allowRoles(...roles) {
  return async (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Permission denied" });
    }

    try {
      const result = await db.query(
        "SELECT is_active FROM users WHERE id = $1",
        [req.user.id]
      );

      if (!result.rows[0]?.is_active) {
        return res.status(403).json({ error: "Account is inactive" });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { authenticate, allowRoles };
