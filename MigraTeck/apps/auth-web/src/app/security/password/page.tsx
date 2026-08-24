/**
 * `/security/password` is an alias, not a second implementation.
 *
 * Both paths get referred to in conversation and in other products' settings
 * copy, and a 404 on the one someone happens to type is indistinguishable from
 * the feature not existing — which is the state this whole surface exists to
 * end. One canonical page, one redirect to it.
 */
import { redirect } from "next/navigation";

export default function SecurityPasswordAlias() {
  redirect("/account/password");
}
