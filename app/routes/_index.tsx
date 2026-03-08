import { redirect } from "react-router";

export async function loader() {
  return redirect("/app");
}

export default function Index() {
  return null;
}
