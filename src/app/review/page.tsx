import { redirect } from "next/navigation";

export default function ReviewRedirectPage() {
  redirect("/history?status=待人工确认");
}
