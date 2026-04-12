import { processSocialConnectionSyncQueue } from "../workers/social-connection-sync";

void processSocialConnectionSyncQueue()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error("social connection sync iteration failed", error);
    process.exitCode = 1;
  });
