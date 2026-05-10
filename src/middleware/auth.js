export function requireAuth(req, res, next) {
  if (req.session?.userId) {
    req.userId = req.session.userId;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

export function requireAdmin(req, res, next) {
  if (req.session?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden' });
}
