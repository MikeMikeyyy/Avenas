// What the training simulation runs in. IMPORT THIS FIRST: it brings the solo
// flows' world with it (../solo/env: Sydney time, a clock the run sets, the
// app's prompts answered by the run, the backup and reminders inert), and
// quiets the one more phone-only call a logged workout reaches: the
// achievement notification.

import "../solo/env";
import { stubModule } from "../app";

stubModule({ file: "utils/notificationScheduler.ts" }, {
  resyncScheduledNotifications: () => {},
  notifyAchievement: () => {},
});
