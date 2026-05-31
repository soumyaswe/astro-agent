function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;
  const message = err.expose ? err.message : "Internal server error";

  res.status(status).json({
    error: message,
  });
}

module.exports = {
  errorHandler,
};
