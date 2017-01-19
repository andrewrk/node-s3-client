function extendError(ctor) {
  ctor.prototype = Object.create(Error.prototype);
  ctor.prototype.isNewsflowError = true;
  ctor.prototype.constructor = ctor;
}

function MissingParameterError(message) {
  this.name = "MissingParameterError";
  this.message = String(message);
  Error.captureStackTrace(this, MissingParameterError);
}
extendError(MissingParameterError);

function InvalidParameterError(message) {
  this.name = "InvalidParameterError";
  this.message = String(message);
  Error.captureStackTrace(this, InvalidParameterError);
}
extendError(InvalidParameterError);

function RequestError(message) {
  this.name = "RequestError";
  this.message = String(message || "Request error");
  Error.captureStackTrace(this, ServerError);
}
extendError(RequestError);

function BadRequestError(message) {
  this.name = "BadRequestError";
  this.status = 400;
  this.message = String(message || "Bad request");
  Error.captureStackTrace(this, BadRequestError);
}
extendError(NotFoundError);

function UnauthorizedError(message) {
  this.name = "AuthenticationError";
  this.status = 401;
  this.message = message || "Unauthorized";
  Error.captureStackTrace(this, UnauthorizedError);
}
extendError(UnauthorizedError);

function ForbiddenError(message) {
  this.name = "ForbiddenError";
  this.status = 403;
  this.message = message || "Forbidden";
  Error.captureStackTrace(this, ForbiddenError);
}
extendError(ForbiddenError);

function NotFoundError(message) {
  this.name = "NotFoundError";
  this.status = 404;
  this.message = String(message || "Not found");
  Error.captureStackTrace(this, NotFoundError);
}
extendError(NotFoundError);

function ServerError(message, code) {
  this.name = "ServerError";
  this.status = code || 500;
  this.message = String(message || "Server error");
  Error.captureStackTrace(this, ServerError);
}
extendError(ServerError);

function errorFromStatusCode(code, message) {
  switch(code) {
  case 400:
    return new BadRequestError(message);

  case 401:
    return new UnauthorizedError(message);

  case 403:
    return new ForbiddenError(message);

  case 404:
    return new NotFoundError(message);

  default:
    return new ServerError(message, code);
  }
}

module.exports = exports = {
  MissingParameterError,
  InvalidParameterError,
  RequestError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ServerError,
  errorFromStatusCode
};
