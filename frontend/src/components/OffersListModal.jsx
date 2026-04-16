import { useEffect, useState } from "react";
import { Modal, Button, Card, Badge } from "react-bootstrap";
import { getOffersByRequest, acceptOffer } from "../api/offers.api";

export default function OffersListModal({ show, onHide, requestId, onAccepted }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [acceptingId, setAcceptingId] = useState("");

  const load = async () => {
    try {
      setErr("");
      setLoading(true);
      const res = await getOffersByRequest(requestId);
      setData(res.data);
    } catch (e) {
      setErr(e?.response?.data?.message || e.message || "Fetch offers failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!show || !requestId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, requestId]);

  const onAccept = async (offerId) => {
    try {
      setAcceptingId(offerId);
      const res = await acceptOffer(offerId);
      onAccepted?.(res.data?.booking || res.data);
      onHide();
    } catch (e) {
      setErr(e?.response?.data?.message || e.message || "Accept offer failed");
    } finally {
      setAcceptingId("");
    }
  };

  const reqDoc = data?.request;
  const offers = data?.offers || [];

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Offers</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {reqDoc ? (
          <div className="mb-3">
            <div className="fw-semibold">{reqDoc.title}</div>
            <div className="text-muted small">
              {reqDoc.location} • <Badge bg="secondary">{reqDoc.serviceType}</Badge>
            </div>
          </div>
        ) : null}

        {err ? <div className="text-danger mb-2">{err}</div> : null}

        {loading ? (
          <div className="text-center text-muted py-4">Loading offers...</div>
        ) : offers.length === 0 ? (
          <div className="text-center text-muted py-4">No offers yet.</div>
        ) : (
          offers.map((o) => (
            <Card key={o._id} className="mb-3">
              <Card.Body className="d-flex justify-content-between align-items-start gap-3">
                <div>
                  <div className="fw-semibold">{o.provider?.name || "Provider"}</div>
                  <div className="text-muted small">
                    ⭐ {o.provider?.ratingAvg ?? 0} ({o.provider?.ratingCount ?? 0})
                  </div>
                  {o.message ? <div className="mt-2">{o.message}</div> : null}
                </div>

                <div className="text-end">
                  <div className="fw-bold mb-2">${o.price}</div>
                  <Button
                    onClick={() => onAccept(o._id)}
                    disabled={!!acceptingId}
                  >
                    {acceptingId === o._id ? "Accepting..." : "Accept"}
                  </Button>
                </div>
              </Card.Body>
            </Card>
          ))
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}