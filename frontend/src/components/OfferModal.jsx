import { useEffect, useState } from "react";
import { Modal, Button, Form } from "react-bootstrap";
import { createOffer } from "../api/offers.api";

export default function OfferModal({ show, onHide, request, onSuccess }) {
  const [price, setPrice] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (show) {
      setPrice("");
      setMessage("");
      setErr("");
      setSaving(false);
    }
  }, [show]);

  const submit = async () => {
    try {
      setErr("");
      setSaving(true);
      await createOffer({
        requestId: request._id,
        price: Number(price),
        message,
      });
      onSuccess?.();
      onHide();
    } catch (e) {
      setErr(e?.response?.data?.message || e.message || "Create offer failed");
    } finally {
      setSaving(false);
    }
  };

  if (!request) return null;

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Send Offer</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <div className="mb-2">
          <div className="fw-semibold">{request.title}</div>
          <div className="text-muted small">
            {request.serviceType} • {request.location}
          </div>
        </div>

        {err ? <div className="text-danger small mb-2">{err}</div> : null}

        <Form.Group className="mb-3">
          <Form.Label>Price ($)</Form.Label>
          <Form.Control
            type="number"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 85"
          />
        </Form.Group>

        <Form.Group>
          <Form.Label>Message</Form.Label>
          <Form.Control
            as="textarea"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Your availability / what’s included..."
          />
        </Form.Group>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving || !price}>
          {saving ? "Sending..." : "Send Offer"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}