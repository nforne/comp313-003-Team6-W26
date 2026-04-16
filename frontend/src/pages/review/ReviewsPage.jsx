import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  ProgressBar,
  Row,
  Spinner,
} from "react-bootstrap";
import { Link } from "react-router-dom";
import { getReviewFeed } from "../../api/reviews.api";

const SERVICE_TYPES = [
  { label: "All Types", value: "all" },
  { label: "Haircut", value: "haircut" },
  { label: "Massage", value: "massage" },
  { label: "Cleaning", value: "cleaning" },
  { label: "Plumbing", value: "plumbing" },
  { label: "Electrical", value: "electrical" },
  { label: "Tutoring", value: "tutoring" },
  { label: "Photography", value: "photography" },
  { label: "Fitness", value: "fitness" },
  { label: "Repair", value: "repair" },
  { label: "Other", value: "other" },
];

const STAR_FILTERS = [
  { label: "All Ratings", value: "all" },
  { label: "5 Stars", value: "5" },
  { label: "4 Stars", value: "4" },
  { label: "3 Stars", value: "3" },
  { label: "2 Stars", value: "2" },
  { label: "1 Star", value: "1" },
];

const SORT_OPTIONS = [
  { label: "Most Recent", value: "recent" },
  { label: "Highest Rating", value: "highest" },
  { label: "Lowest Rating", value: "lowest" },
];

function formatDate(date) {
  if (!date) return "Unknown date";

  try {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Unknown date";
  }
}

function getInitial(name = "U") {
  return String(name).trim().charAt(0).toUpperCase() || "U";
}

function Stars({ value = 0, size = 18 }) {
  const numericValue = Number(value) || 0;
  const fullStars = Math.round(numericValue);
  const stars = Array.from({ length: 5 }, (_, i) => (i < fullStars ? "★" : "☆")).join("");

  return (
    <span
      style={{
        fontSize: size,
        letterSpacing: 1,
        color: "#f59e0b",
        lineHeight: 1,
      }}
      aria-label={`${numericValue} out of 5 stars`}
      title={`${numericValue} / 5`}
    >
      {stars}
    </span>
  );
}

function AvatarCircle({ name = "U", bg = "#2563eb", size = 44 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.38,
        flexShrink: 0,
        boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
      }}
    >
      {getInitial(name)}
    </div>
  );
}

function RatingBreakdownRow({ star, count, total }) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div className="d-flex align-items-center gap-2 mb-2">
      <div style={{ width: 50, fontSize: 14, fontWeight: 600 }}>{star}★</div>
      <div className="flex-grow-1">
        <ProgressBar
          now={percent}
          style={{
            height: 8,
            borderRadius: 999,
            backgroundColor: "#e5e7eb",
          }}
        />
      </div>
      <div
        style={{
          width: 48,
          textAlign: "right",
          fontSize: 13,
          opacity: 0.8,
        }}
      >
        {count}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Alert
      variant="light"
      className="border rounded-4 py-4 px-4 text-center"
      style={{ background: "#f8fafc" }}
    >
      <div className="fw-semibold mb-1">No reviews found</div>
      <div style={{ opacity: 0.7 }}>
        Try another service type or rating filter.
      </div>
    </Alert>
  );
}

export default function ReviewsPage() {
  const [serviceType, setServiceType] = useState("all");
  const [starFilter, setStarFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recent");

  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [err, setErr] = useState("");

  const [serverStats, setServerStats] = useState({
    avg: "0.0",
    total: 0,
    counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  });

  const title = useMemo(() => {
    const found = SERVICE_TYPES.find((x) => x.value === serviceType);
    return found?.label || "All Types";
  }, [serviceType]);

  const loadReviews = async ({ reset = false } = {}) => {
    setErr("");
    setLoading(true);

    if (reset) {
      setInitialLoading(true);
    }

    try {
      const nextPage = reset ? 1 : page;

      const res = await getReviewFeed({
        serviceType,
        page: nextPage,
        limit: 9,
      });

      const payload = res?.data || {};
      const newItems = Array.isArray(payload.items) ? payload.items : [];
      const nextHasMore = Boolean(payload.hasMore);

      if (reset) {
        setItems(newItems);
        setPage(2);
        setHasMore(nextHasMore);
        setServerStats(
          payload.stats || {
            avg: "0.0",
            total: 0,
            counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          }
        );
      } else {
        setItems((prev) => [...prev, ...newItems]);
        setPage((prev) => prev + 1);
        setHasMore(nextHasMore);
      }
    } catch (e) {
      setErr(e?.response?.data?.message || "Failed to load reviews");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    loadReviews({ reset: true });
  }, [serviceType]);

  const filteredItems = useMemo(() => {
    let result = [...items];

    if (starFilter !== "all") {
      result = result.filter(
        (r) => Math.round(Number(r.rating) || 0) === Number(starFilter)
      );
    }

    if (sortBy === "highest") {
      result.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
    } else if (sortBy === "lowest") {
      result.sort((a, b) => (Number(a.rating) || 0) - (Number(b.rating) || 0));
    } else {
      result.sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
      );
    }

    return result;
  }, [items, starFilter, sortBy]);

  const displayStats = useMemo(() => {
    if (starFilter === "all") return serverStats;

    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;

    for (const r of filteredItems) {
      const rating = Math.round(Number(r.rating) || 0);

      if (rating >= 1 && rating <= 5) {
        counts[rating] += 1;
        total += 1;
        sum += rating;
      }
    }

    return {
      total,
      avg: total > 0 ? (sum / total).toFixed(1) : "0.0",
      counts,
    };
  }, [filteredItems, starFilter, serverStats]);

  return (
    <Container className="py-4 py-lg-5">
      <Row className="align-items-end g-3 mb-4">
        <Col lg={5}>
          <div className="mb-1" style={{ fontSize: 14, color: "#6b7280" }}>
            Verified customer feedback
          </div>
          <h2 className="mb-2 fw-bold">{title} Reviews</h2>
          <div style={{ color: "#6b7280" }}>
            Public reviews posted by customers after completed bookings.
          </div>
        </Col>

        <Col md={4} lg={3}>
          <Form.Label className="mb-1">Service Type</Form.Label>
          <Form.Select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className="rounded-3"
          >
            {SERVICE_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Form.Select>
        </Col>

        <Col md={4} lg={2}>
          <Form.Label className="mb-1">Rating</Form.Label>
          <Form.Select
            value={starFilter}
            onChange={(e) => setStarFilter(e.target.value)}
            className="rounded-3"
          >
            {STAR_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Form.Select>
        </Col>

        <Col md={4} lg={2}>
          <Form.Label className="mb-1">Sort</Form.Label>
          <Form.Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-3"
          >
            {SORT_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {err && (
        <Alert variant="danger" className="rounded-4 mb-4">
          {err}
        </Alert>
      )}

      {!err && (
        <Card className="border-0 shadow-sm rounded-4 mb-4">
          <Card.Body className="p-4">
            <Row className="align-items-center g-4">
              <Col md={4}>
                <div
                  style={{
                    fontSize: 40,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: "#111827",
                  }}
                >
                  {displayStats.avg}
                </div>

                <div className="mt-2">
                  <Stars value={Number(displayStats.avg)} size={24} />
                </div>

                <div className="mt-2" style={{ color: "#6b7280" }}>
                  Based on {displayStats.total} review
                  {displayStats.total !== 1 ? "s" : ""}
                </div>
              </Col>

              <Col md={8}>
                {[5, 4, 3, 2, 1].map((star) => (
                  <RatingBreakdownRow
                    key={star}
                    star={star}
                    count={displayStats.counts[star]}
                    total={displayStats.total}
                  />
                ))}
              </Col>
            </Row>
          </Card.Body>
        </Card>
      )}

      {initialLoading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
          <div className="mt-3" style={{ color: "#6b7280" }}>
            Loading reviews...
          </div>
        </div>
      ) : filteredItems.length === 0 && !err ? (
        <EmptyState />
      ) : (
        <>
          <Row className="g-4">
            {filteredItems.map((r) => {
              const providerRating = Number(r.provider?.ratingAvg ?? r.rating ?? 0);
              const providerRatingCount =
                Number(r.provider?.ratingCount ?? 0) > 0
                  ? Number(r.provider?.ratingCount)
                  : 1;

              return (
                <Col key={r._id} md={6} xl={4}>
                  <Card
                    className="h-100 border-0 shadow-sm rounded-4"
                    style={{
                      overflow: "hidden",
                      transition: "transform 0.25s ease, box-shadow 0.25s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-6px)";
                      e.currentTarget.style.boxShadow =
                        "0 18px 40px rgba(15, 23, 42, 0.12)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "";
                    }}
                  >
                    <Card.Body className="p-4 d-flex flex-column">
                      <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                        <div className="d-flex align-items-start gap-3">
                          <AvatarCircle
                            name={r.customer?.name || "Anonymous"}
                            bg="#2563eb"
                            size={46}
                          />

                          <div>
                            <div className="d-flex align-items-center flex-wrap gap-2 mb-1">
                              <div
                                className="fw-semibold"
                                style={{ fontSize: 16, color: "#111827" }}
                              >
                                {r.customer?.name || "Anonymous Customer"}
                              </div>

                              <Badge
                                pill
                                style={{
                                  background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
                                  color: "#047857",
                                  border: "1px solid #a7f3d0",
                                  fontWeight: 700,
                                  padding: "6px 10px",
                                  fontSize: 11,
                                  letterSpacing: 0.2,
                                  boxShadow: "0 4px 12px rgba(16,185,129,0.12)",
                                }}
                              >
                                ✓ Verified
                              </Badge>
                            </div>

                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                              {formatDate(r.createdAt)}
                            </div>
                          </div>
                        </div>

                        <Badge bg="dark" pill>
                          {(r.serviceType || "other").toUpperCase()}
                        </Badge>
                      </div>

                      <div className="mb-2">
                        <Stars value={r.rating} size={20} />
                      </div>

                      {r.serviceTitle && (
                        <div
                          className="fw-semibold mb-2"
                          style={{ fontSize: 15, color: "#111827" }}
                        >
                          {r.serviceTitle}
                        </div>
                      )}

                      <div
                        className="mb-3"
                        style={{
                          whiteSpace: "pre-wrap",
                          color: "#374151",
                          minHeight: 78,
                          lineHeight: 1.6,
                        }}
                      >
                        {r.comment || (
                          <span style={{ color: "#9ca3af" }}>(No comment)</span>
                        )}
                      </div>

                      <div className="mt-auto">
                        <div
                          className="p-3 rounded-4"
                          style={{
                            background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
                            fontSize: 14,
                            border: "1px solid #e5e7eb",
                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
                          }}
                        >
                          <div className="d-flex align-items-start gap-3">
                            <AvatarCircle
                              name={r.provider?.name || "Provider"}
                              bg="#16a34a"
                              size={42}
                            />

                            <div className="flex-grow-1">
                              <div className="d-flex align-items-center flex-wrap gap-2 mb-1">
                                <strong style={{ color: "#111827" }}>
                                  {r.provider?.name || "Unknown Provider"}
                                </strong>

                                <Badge
                                  pill
                                  style={{
                                    background: "#eff6ff",
                                    color: "#1d4ed8",
                                    border: "1px solid #bfdbfe",
                                    fontWeight: 700,
                                    padding: "5px 10px",
                                    fontSize: 11,
                                  }}
                                >
                                  Top Provider
                                </Badge>
                              </div>

                              <div className="d-flex align-items-center flex-wrap gap-2 mb-2">
                                <Stars value={providerRating} size={16} />
                                <span style={{ color: "#374151", fontWeight: 600 }}>
                                  {providerRating.toFixed(1)} / 5
                                </span>
                                <span style={{ color: "#9ca3af" }}>•</span>
                                <span style={{ color: "#6b7280" }}>
                                  {providerRatingCount} review
                                  {providerRatingCount !== 1 ? "s" : ""}
                                </span>
                              </div>

                              <Link
                                to={`/providers/${r.provider?._id || ""}`}
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "#2563eb",
                                  textDecoration: "none",
                                }}
                              >
                                View provider profile →
                              </Link>
                            </div>
                          </div>
                        </div>

                        {r.reply && (
                          <div
                            className="mt-3 p-3 rounded-4"
                            style={{
                              background: "#fff7ed",
                              border: "1px solid #fed7aa",
                              fontSize: 14,
                            }}
                          >
                            <div className="fw-semibold mb-1">Provider reply</div>
                            <div
                              style={{
                                whiteSpace: "pre-wrap",
                                lineHeight: 1.55,
                                color: "#374151",
                              }}
                            >
                              {r.reply}
                            </div>
                          </div>
                        )}
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              );
            })}
          </Row>

          <div className="d-flex justify-content-center mt-4">
            {loading ? (
              <Button variant="secondary" disabled className="rounded-pill px-4">
                <Spinner size="sm" className="me-2" />
                Loading...
              </Button>
            ) : hasMore ? (
              <Button
                variant="primary"
                onClick={() => loadReviews({ reset: false })}
                className="rounded-pill px-4"
              >
                Load more
              </Button>
            ) : (
              <div style={{ color: "#6b7280" }}>No more reviews.</div>
            )}
          </div>
        </>
      )}
    </Container>
  );
}