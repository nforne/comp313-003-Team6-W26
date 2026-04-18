import { Spinner } from "react-bootstrap";

export default function LoadingBlock({ text = "Loading..." }) {
  return (
    <div className="py-5 text-center">
      <Spinner animation="border" role="status" />
      <div className="mt-2 text-muted">{text}</div>
    </div>
  );
}