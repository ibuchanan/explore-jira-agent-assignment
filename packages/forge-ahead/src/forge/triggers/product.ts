import type { CommonEvent, InstallContext } from "../function";
// import { truncateEvents } from "../logging";

export type TriggerEvent = CommonEvent;
export type TriggerFunction = (
  request: TriggerEvent,
  context: InstallContext,
) => Promise<void>;

export const productEventHandler: TriggerFunction = async (
  request,
  _context,
) => {
  // import { truncateEvents } from "../logging";
  // console.debug(`trigger request: ${JSON.stringify(truncateEvents(request))}`);
  // console.debug(`trigger context: ${JSON.stringify(truncateEvents(_context))}`);
  console.debug(`trigger for ${request.context.moduleKey}`);
};
