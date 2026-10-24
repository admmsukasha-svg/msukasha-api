exports.notFound = (req, res) => res.status(404).json({ error: 'Route not found.' });

// eslint-disable-next-line no-unused-vars
exports.errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || 'Server error.';

  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join(' ');
  } else if (err.name === 'CastError') {
    status = 400; message = 'Invalid value for ' + err.path + '.';
  } else if (err.code === 11000) {
    status = 409; message = 'This record already exists.';
  } else if (err.type === 'entity.too.large') {
    status = 413; message = 'Request is too large.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; message = 'Invalid JSON body.';
  }

  if (status >= 500) {
    console.error(err);
    message = 'Something went wrong on our side. Please try again.';
  }
  res.status(status).json(err.code && status < 500 ? { error: message, code: err.code } : { error: message });
};
