import { Container, Row, Col, Card, Badge, Button, Form } from "react-bootstrap";
import {
  FaHandshake,
  FaSearch,
  FaStar,
  FaBolt,
  FaShieldAlt,
  FaCheckCircle,
  FaLinkedin,
  FaInstagram,
  FaFacebookF,
  FaHeadset,
} from "react-icons/fa";

export default function About() {
  const features = [
    {
      icon: <FaHandshake size={20} />,
      title: "Trusted Providers",
      desc: "Work with reliable providers backed by profiles, reviews, and service history.",
    },
    {
      icon: <FaSearch size={20} />,
      title: "Compare Multiple Bids",
      desc: "Receive competitive offers and choose the best match for your needs and budget.",
    },
    {
      icon: <FaStar size={20} />,
      title: "Reviews & Ratings",
      desc: "Make informed decisions using real feedback from verified customers.",
    },
    {
      icon: <FaBolt size={20} />,
      title: "Fast & Simple Booking",
      desc: "Create a request in minutes, confirm a bid, and track status effortlessly.",
    },
    {
      icon: <FaShieldAlt size={20} />,
      title: "Transparent Experience",
      desc: "Clear pricing, service details, and booking updates—no hidden surprises.",
    },
    {
      icon: <FaCheckCircle size={20} />,
      title: "Quality First",
      desc: "A smoother workflow for both customers and providers from request to completion.",
    },
  ];

  const testimonials = [
    {
      name: "Alice Johnson",
      role: "Bride & Event Client",
      text: "Excellent job! The provider was professional, friendly, and made the whole booking experience stress-free.",
    },
    {
      name: "Michael Smith",
      role: "Home Service Customer",
      text: "BookEase made it easy to compare offers and find the right provider quickly. I would definitely use it again.",
    },
    {
      name: "Sophia Lee",
      role: "Beauty Service Client",
      text: "I loved how simple and transparent everything was. Great communication, fair pricing, and excellent final results.",
    },
  ];

  return (
    <div style={{ background: "#f8fbff" }}>
      {/* HERO */}
      <div
        style={{
          padding: "88px 0 64px",
          background:
            "linear-gradient(135deg, #eff6ff 0%, #f0fdf4 45%, #ffffff 100%)",
          borderBottom: "1px solid rgba(15, 23, 42, 0.06)",
        }}
      >
        <Container>
          <Row className="align-items-center g-4">
            <Col md={7}>
              <Badge
                bg=""
                style={{
                  fontSize: 13,
                  padding: "8px 14px",
                  borderRadius: 999,
                  background: "rgba(37, 99, 235, 0.12)",
                  color: "#2563eb",
                  border: "1px solid rgba(37, 99, 235, 0.15)",
                  fontWeight: 700,
                }}
              >
                Local Service Marketplace
              </Badge>

              <h1
                style={{
                  marginTop: 18,
                  fontSize: 48,
                  lineHeight: 1.1,
                  fontWeight: 800,
                  letterSpacing: "-1px",
                  color: "#0f172a",
                }}
              >
                About <span style={{ color: "#2563eb" }}>BookEase</span>
              </h1>

              <p
                style={{
                  marginTop: 18,
                  fontSize: 18,
                  color: "#475569",
                  lineHeight: 1.8,
                  maxWidth: 680,
                }}
              >
                BookEase is a modern platform that connects customers with trusted
                local providers. Request a service, receive bids, compare options,
                and book confidently—backed by transparent details and user reviews.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  marginTop: 22,
                }}
              >
                <Badge
                  bg=""
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: "#ffffff",
                    color: "#334155",
                    border: "1px solid #e2e8f0",
                    fontWeight: 600,
                  }}
                >
                  ✔ Simple booking flow
                </Badge>
                <Badge
                  bg=""
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: "#ffffff",
                    color: "#334155",
                    border: "1px solid #e2e8f0",
                    fontWeight: 600,
                  }}
                >
                  ✔ Bid comparison
                </Badge>
                <Badge
                  bg=""
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: "#ffffff",
                    color: "#334155",
                    border: "1px solid #e2e8f0",
                    fontWeight: 600,
                  }}
                >
                  ✔ Ratings & reviews
                </Badge>
              </div>
            </Col>

            <Col md={5}>
              <Card
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.15)",
                  borderRadius: 24,
                  boxShadow: "0 20px 45px rgba(15, 23, 42, 0.08)",
                  background: "rgba(255,255,255,0.95)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <Card.Body style={{ padding: 26 }}>
                  <h5
                    style={{
                      fontWeight: 800,
                      marginBottom: 12,
                      color: "#0f172a",
                    }}
                  >
                    Our Mission
                  </h5>

                  <p
                    style={{
                      color: "#475569",
                      lineHeight: 1.8,
                      marginBottom: 18,
                    }}
                  >
                    To make booking local services simple, transparent, and reliable
                    for everyone—while helping providers grow through fair
                    opportunities.
                  </p>

                  <div
                    style={{
                      padding: 16,
                      background: "linear-gradient(135deg, #eff6ff, #ecfdf5)",
                      borderRadius: 18,
                      border: "1px solid rgba(37,99,235,0.12)",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        marginBottom: 8,
                        color: "#0f172a",
                      }}
                    >
                      What we focus on
                    </div>
                    <div style={{ color: "#475569", lineHeight: 1.6 }}>
                      Trust • Speed • Clarity • Great user experience
                    </div>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </div>

      {/* FEATURES */}
      <Container style={{ padding: "72px 0" }}>
        <Row className="mb-4">
          <Col>
            <h2
              style={{
                fontWeight: 800,
                letterSpacing: "-0.5px",
                color: "#0f172a",
              }}
            >
              Why Choose BookEase?
            </h2>
            <p
              style={{
                color: "#64748b",
                lineHeight: 1.8,
                maxWidth: 820,
                fontSize: 17,
              }}
            >
              Designed for a smooth end-to-end experience: customers can find the
              right provider faster, and providers can bid on real opportunities
              that match their skills and availability.
            </p>
          </Col>
        </Row>

        <Row className="g-4">
          {features.map((f, idx) => (
            <Col key={idx} md={6} lg={4}>
              <Card
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.14)",
                  borderRadius: 22,
                  height: "100%",
                  boxShadow: "0 14px 34px rgba(15, 23, 42, 0.05)",
                  background: "#ffffff",
                  transition: "0.3s ease",
                }}
              >
                <Card.Body style={{ padding: 22 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 16,
                      display: "grid",
                      placeItems: "center",
                      background:
                        "linear-gradient(135deg, rgba(37,99,235,0.14), rgba(16,185,129,0.14))",
                      color: "#2563eb",
                      marginBottom: 14,
                    }}
                  >
                    {f.icon}
                  </div>

                  <h5
                    style={{
                      fontWeight: 800,
                      marginBottom: 10,
                      color: "#0f172a",
                    }}
                  >
                    {f.title}
                  </h5>

                  <p
                    style={{
                      color: "#64748b",
                      lineHeight: 1.8,
                      marginBottom: 0,
                    }}
                  >
                    {f.desc}
                  </p>
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>

        <Row className="mt-5">
          <Col>
            <Card
              style={{
                border: "1px solid rgba(148, 163, 184, 0.14)",
                borderRadius: 22,
                background: "linear-gradient(135deg, #ffffff, #f8fafc)",
                boxShadow: "0 14px 34px rgba(15, 23, 42, 0.05)",
              }}
            >
              <Card.Body style={{ padding: 24 }}>
                <h5
                  style={{
                    fontWeight: 800,
                    marginBottom: 10,
                    color: "#0f172a",
                  }}
                >
                  Built for your workflow
                </h5>

                <p
                  style={{
                    color: "#64748b",
                    lineHeight: 1.8,
                    marginBottom: 0,
                  }}
                >
                  BookEase supports the full lifecycle:{" "}
                  <b style={{ color: "#1e293b" }}>
                    Request → Bids → Selection → Booking → Completion → Review
                  </b>
                  . This makes it easier to track progress and maintain trust on
                  both sides.
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>

      {/* TESTIMONIALS */}
      <div
        style={{
          padding: "88px 0",
          background:
            "linear-gradient(180deg, #ffffff 0%, #f8fbff 50%, #f1f5f9 100%)",
        }}
      >
        <Container>
          <div className="text-center mb-5">
            <div
              style={{
                color: "#2563eb",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              Featured Client Testimonials
            </div>

            <h2
              style={{
                fontSize: 44,
                fontWeight: 800,
                lineHeight: 1.15,
                marginBottom: 18,
                color: "#4408d2",
              }}
            >
              Hear From Our Satisfied Clients
            </h2>

            <p
              style={{
                color: "#64748b",
                fontSize: 18,
                maxWidth: 900,
                margin: "0 auto",
                lineHeight: 1.8,
              }}
            >
              Discover how our clients have transformed their booking experience
              and achieved outstanding results with BookEase.
            </p>
          </div>

          <Row className="g-4">
            {testimonials.map((item, idx) => (
              <Col key={idx} lg={4}>
                <Card
                  style={{
                    border: "1px solid rgba(148, 163, 184, 0.12)",
                    borderRadius: 24,
                    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.06)",
                    height: "100%",
                    background: "#ffffff",
                  }}
                >
                  <Card.Body style={{ padding: 28 }}>
                    <div
                      style={{
                        color: "#f59e0b",
                        fontSize: 22,
                        marginBottom: 16,
                        letterSpacing: 2,
                      }}
                    >
                      ★★★★★
                    </div>

                    <p
                      style={{
                        color: "#475569",
                        fontSize: 17,
                        lineHeight: 1.9,
                        minHeight: 130,
                        marginBottom: 24,
                      }}
                    >
                      {item.text}
                    </p>

                    <div>
                      <h5
                        style={{
                          fontWeight: 800,
                          marginBottom: 6,
                          color: "#0f172a",
                        }}
                      >
                        {item.name}
                      </h5>
                      <div style={{ color: "#94a3b8", fontSize: 15 }}>
                        {item.role}
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        </Container>
      </div>

      {/* CTA */}
      <div
        style={{
          background: "linear-gradient(135deg, #0f172a, #1e293b)",
          color: "#fff",
          padding: "52px 0",
        }}
      >
        <Container>
          <Row className="align-items-center g-4">
            <Col lg={8}>
              <h2
                style={{
                  fontSize: 30,
                  lineHeight: 1.4,
                  marginBottom: 0,
                  fontWeight: 600,
                }}
              >
                Ready to learn more or get started? Contact us today and discover
                how BookEase can simplify your service booking experience.
              </h2>
            </Col>

            <Col lg={4} className="text-lg-end">
              <Button
                href="/contact"
                style={{
                  background: "linear-gradient(135deg, #1ab656, #10b34f)",
                  border: "none",
                  borderRadius: 999,
                  padding: "15px 32px",
                  fontWeight: 700,
                  fontSize: 18,
                  boxShadow: "0 10px 25px rgba(26, 182, 86, 0.35)",
                }}
              >
                Contact Us
              </Button>
            </Col>
          </Row>
        </Container>
      </div>
    </div>
  );
}