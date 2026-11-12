import type { Metadata } from "next";
import AdminConsole from "./admin-console";
export const metadata: Metadata = {
  title: "Collection — администрирование",
  description:
    "Управление пользователями, объектами, запасами и перевозками Collection.",
};
export default function AdminPage() {
  return <AdminConsole />;
}
