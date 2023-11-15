import * as ClientRequest from "@effect/platform/Http/ClientRequest";
import { Schema } from "@effect/schema";
import { Effect, identity, pipe } from "effect";
import {
  Api,
  ClientError,
  Middlewares,
  RouterBuilder,
  ServerError,
  Testing,
} from "effect-http";

import { runTestEffect } from "./utils";

const helloApi = pipe(
  Api.api(),
  Api.get("ping", "/ping", {
    response: Schema.literal("pong"),
  }),
  Api.get("hello", "/hello", {
    response: Schema.string,
  }),
);

test("basic auth", async () => {
  const app = pipe(
    RouterBuilder.make(helloApi),
    RouterBuilder.handle("ping", () => Effect.succeed("pong" as const)),
    RouterBuilder.handle("hello", () => Effect.succeed("test")),
    RouterBuilder.build,
    Middlewares.basicAuth(
      ({ user, password }) => {
        if (user === "mike" && password === "the-stock-broker") {
          return Effect.unit;
        }

        return Effect.fail(ServerError.unauthorizedError("Wrong credentials"));
      },
      { skipPaths: ["/ping"] },
    ),
    Effect.tapErrorCause(Effect.logError),
  );

  const incorrectCredentials = Buffer.from("user:password").toString("base64");
  const correctCredentials = Buffer.from("mike:the-stock-broker").toString(
    "base64",
  );

  const client = (
    mapRequest: (
      request: ClientRequest.ClientRequest,
    ) => ClientRequest.ClientRequest,
  ) => Testing.make(app, helloApi, { mapRequest });

  const result = await pipe(
    Effect.all([
      client(
        ClientRequest.setHeader(
          "Authorization",
          `Basic ${incorrectCredentials}`,
        ),
      ).pipe(
        Effect.flatMap((client) =>
          client
            .hello({
              headers: { Authorization: `Basic ${incorrectCredentials}` },
            })
            .pipe(Effect.flip),
        ),
      ),
      client(
        ClientRequest.setHeader(
          "Authorization",
          `Basic ${incorrectCredentials}`,
        ),
      ).pipe(
        Effect.flatMap((client) =>
          client.hello({
            headers: { Authorization: `Basic ${correctCredentials}` },
          }),
        ),
      ),
      client(identity).pipe(Effect.flatMap((client) => client.ping())),
    ]),
    runTestEffect,
  );

  expect(result).toEqual([
    ClientError.HttpClientError.create("Wrong credentials", 403),
    "test",
    "pong",
  ]);
});