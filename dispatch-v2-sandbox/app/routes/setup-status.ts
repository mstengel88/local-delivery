import { data } from "react-router";

import { getDispatchAuthSetupStatus } from "../lib/auth.server";

export async function loader() {
  return data(await getDispatchAuthSetupStatus());
}
