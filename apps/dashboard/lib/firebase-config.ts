/**
 * The Firebase Auth client configuration, read on the server and handed to the
 * one client component that signs a person in.
 *
 * The canonical variable list (AGENTS.md section 8) names these `FIREBASE_*`
 * rather than `NEXT_PUBLIC_FIREBASE_*`, so they are not inlined into the client
 * bundle by the framework. Nothing here is a secret: a Firebase web API key
 * identifies a project, it does not authorise anything. It travels as a prop
 * from a server component so the env list stays exactly as the constitution
 * declares it.
 */

export interface FirebaseClientConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
}

/**
 * The config, or a list of what is missing. Reads rather than throws, so the
 * login page can say which variables to fill in instead of showing a stack.
 */
export function readFirebaseClientConfig():
  | { config: FirebaseClientConfig; missing: null }
  | { config: null; missing: string[] } {
  const wanted: Record<
    keyof FirebaseClientConfig,
    [string, string | undefined]
  > = {
    apiKey: ["FIREBASE_API_KEY", process.env.FIREBASE_API_KEY],
    authDomain: ["FIREBASE_AUTH_DOMAIN", process.env.FIREBASE_AUTH_DOMAIN],
    projectId: ["FIREBASE_PROJECT_ID", process.env.FIREBASE_PROJECT_ID],
    appId: ["FIREBASE_APP_ID", process.env.FIREBASE_APP_ID],
  }

  const missing = Object.values(wanted)
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) return { config: null, missing }

  return {
    config: {
      apiKey: wanted.apiKey[1] as string,
      authDomain: wanted.authDomain[1] as string,
      projectId: wanted.projectId[1] as string,
      appId: wanted.appId[1] as string,
    },
    missing: null,
  }
}
