import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { corsOptions, allowedOrigins } from "./config/cors.js";
import routes from "./routes/index.js";
import { verify as verifySsoToken } from "./controllers/ssoController.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

const app = express();

app.set("trust proxy", 1); // behind nginx — needed for real client IPs in the audit log

app.use(helmet());
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // answer preflight on every route
app.use(express.json({ limit: "1mb" }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// Same prefix as the three CRMs, so nginx config and client code stay uniform.
app.use("/api/v1", routes);

// Deliberately outside /api/v1: the CRM backends already call
// `${ROOT_ERP_API_URL}/api/auth/verify-sso-token`, and Delta ships that path in
// production today. Matching it here avoids editing deployed CRM code.
app.get("/api/auth/verify-sso-token", verifySsoToken);

app.use(notFound);
app.use(errorHandler);

const start = async () => {
  await connectDB();
  app.listen(Number(env.PORT), () => {
    console.log(`Root CRM API listening on :${env.PORT} (${env.NODE_ENV})`);
    console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
  });
};

start();

export default app;
