import { Alert } from "react-bootstrap";

export default function ErrorBlock({ error }) {
  if (!error) return null;
  const msg = typeof error === "string" ? error : error?.message || "Something went wrong";
  return <Alert variant="danger" className="my-3">{msg}</Alert>;
}