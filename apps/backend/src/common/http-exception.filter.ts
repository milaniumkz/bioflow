import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : "Internal server error";
    response.status(status).json({
      error: {
        statusCode: status,
        message: typeof body === "string" ? body : (body as { message?: unknown }).message ?? "Request failed",
        path: request.url,
        requestId: request.headers["x-request-id"]
      }
    });
  }
}
