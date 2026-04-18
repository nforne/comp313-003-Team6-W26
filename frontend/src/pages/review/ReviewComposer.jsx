import { useState } from "react";
import { Button, Form } from "react-bootstrap";
import { createReview } from "../api/reviews.api";

function StarPicker({ value, onChange }) {
  return (
    <div style={{ fontSize: 22, letterSpacing: 2 }}>
      {[1,2,3,4,5].map((n) => (
        <span
          key={n}
          style={{ cursor: "pointer" }}
          onClick={() => onChange(n)}
          title={`${n} star`}
        >
          {n <= value ? "★" : "☆"}
        </span>
      ))}
    </div>
  );
}

export default function ReviewComposer({
  bookingId,
  serviceType,
  serviceTitle,
  onPosted, 
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    setLoading(true);
    try {
      await createReview({
        bookingId,
        rating,
        comment,

        serviceType,
        serviceTitle,
      });

      setComment("");
      onPosted?.();
    } catch (e) {
      setErr(e?.response?.data?.message || "Post review failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between">
        <div>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Your satisfaction</div>
          <StarPicker value={rating} onChange={setRating} />
        </div>

        <Button disabled={loading} onClick={submit}>
          {loading ? "Posting..." : "Post"}
        </Button>
      </div>

      <Form.Control
        className="mt-2"
        as="textarea"
        rows={2}
        placeholder="Write a short comment (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {selectedBooking && (
  <ReviewComposer
    bookingId={selectedBooking._id}
    serviceType={selectedBooking.service?.serviceType}
    serviceTitle={selectedBooking.service?.title}
    onPosted={() => {
      setSelectedBooking(null);
      fetchBookings();
    }}
  />
)}

      {err && <div className="text-danger mt-2" style={{ fontSize: 13 }}>{err}</div>}
    </div>
  );
}