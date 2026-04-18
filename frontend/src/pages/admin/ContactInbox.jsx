import { useEffect, useMemo, useState } from "react";
import { adminDeleteMessage, adminGetMessages, adminMarkRead } from "../../api/contact.api";

const PAGE_SIZE = 8;

export default function ContactInbox() {
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState("new"); // "new" | "all"
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    setLoading(true);
    try {
      const res = await adminGetMessages();
      setItems(res.data || []);
    } catch (e) {
      setErr(e?.response?.data?.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [tab, q]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    let list = items;

    if (tab === "new") list = list.filter((m) => (m.status || "new") === "new");

    if (query) {
      list = list.filter((m) => {
        const hay = [
          m.name,
          m.email,
          m.phone,
          m.message,
          m.purpose,
          m.address,
          String(m.rating ?? ""),
          m.attachmentUrl,
          m?.location?.lat ? `${m.location.lat}` : "",
          m?.location?.lng ? `${m.location.lng}` : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(query);
      });
    }

    return list;
  }, [items, tab, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const newCount = useMemo(
    () => items.filter((m) => (m.status || "new") === "new").length,
    [items]
  );

  const markRead = async (id) => {
    try {
      setItems((prev) =>
        prev.map((m) =>
          m._id === id ? { ...m, status: "read", readAt: new Date().toISOString() } : m
        )
      );
      await adminMarkRead(id);
    } catch (e) {
      setErr(e?.response?.data?.message || "Failed to mark as read");
      load();
    }
  };

  const del = async (id) => {
    if (!confirm("Delete this message?")) return;
    try {
      setItems((prev) => prev.filter((m) => m._id !== id));
      await adminDeleteMessage(id);
      if (selected?._id === id) setSelected(null);
    } catch (e) {
      setErr(e?.response?.data?.message || "Failed to delete");
      load();
    }
  };

  const openDetail = async (m) => {
    setSelected(m);
    if ((m.status || "new") === "new") {
      await markRead(m._id);
    }
  };

  const toMapsLink = (loc) => {
    if (!loc?.lat || !loc?.lng) return "";
    return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Contact Inbox</h2>
          <p className="text-sm text-apple-gray-500">
            Manage contact messages (mark read, search, delete).
          </p>
        </div>

        <button
          onClick={load}
          className="px-4 py-2 rounded-xl bg-apple-gray-100 hover:bg-apple-gray-200 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Controls */}
      <div className="glass-card rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3 md:justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab("new")}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "new"
                ? "bg-blue-50 text-apple-blue"
                : "bg-apple-gray-100 text-apple-gray-700 hover:bg-apple-gray-200"
            }`}
          >
            New
            <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-white/70">
              {newCount}
            </span>
          </button>

          <button
            onClick={() => setTab("all")}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === "all"
                ? "bg-blue-50 text-apple-blue"
                : "bg-apple-gray-100 text-apple-gray-700 hover:bg-apple-gray-200"
            }`}
          >
            All
            <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full bg-white/70">
              {items.length}
            </span>
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone, purpose, address..."
          className="w-full md:w-[420px] px-4 py-2.5 rounded-xl border border-apple-gray-200 focus:outline-none"
        />
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-xl">
          {err}
        </div>
      )}

      {/* List */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-3 text-xs uppercase tracking-wider text-apple-gray-500 border-b border-apple-gray-100">
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Name</div>
          <div className="col-span-3">Email</div>
          <div className="col-span-2">Purpose</div>
          <div className="col-span-2">Rating</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        {loading ? (
          <div className="p-6 text-apple-gray-500">Loading messages...</div>
        ) : pageItems.length === 0 ? (
          <div className="p-6 text-apple-gray-500">No messages found.</div>
        ) : (
          pageItems.map((m) => (
            <div
              key={m._id}
              className="grid grid-cols-12 px-4 py-3 text-sm border-b border-apple-gray-100 hover:bg-apple-gray-50 cursor-pointer"
              onClick={() => openDetail(m)}
              role="button"
              tabIndex={0}
            >
              <div className="col-span-2">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    (m.status || "new") === "new"
                      ? "bg-blue-50 text-apple-blue"
                      : "bg-apple-gray-100 text-apple-gray-600"
                  }`}
                >
                  {m.status || "new"}
                </span>
              </div>

              <div className="col-span-2 truncate font-medium text-apple-gray-900">
                {m.name}
              </div>

              <div className="col-span-3 truncate text-apple-gray-700">
                {m.email}
              </div>

              <div className="col-span-2 truncate text-apple-gray-700">
                {m.purpose || "General"}
              </div>

              <div className="col-span-2 text-apple-gray-700">
                {m.rating ? `${m.rating}/5` : "—"}
              </div>

              <div className="col-span-1 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                {(m.status || "new") === "new" && (
                  <button
                    onClick={() => markRead(m._id)}
                    className="px-3 py-1 rounded-lg bg-blue-50 text-apple-blue text-xs font-semibold hover:bg-blue-100"
                  >
                    Read
                  </button>
                )}
                <button
                  onClick={() => del(m._id)}
                  className="px-3 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100"
                >
                  Del
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-apple-gray-500">
          Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
        </p>

        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-2 rounded-xl bg-apple-gray-100 hover:bg-apple-gray-200 text-sm font-medium disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm font-semibold">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-2 rounded-xl bg-apple-gray-100 hover:bg-apple-gray-200 text-sm font-medium disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/30 z-[60] flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="glass-card rounded-2xl w-full max-w-[760px] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold">{selected.name}</h3>
                <p className="text-sm text-apple-gray-500">{selected.email}</p>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      (selected.status || "new") === "new"
                        ? "bg-blue-50 text-apple-blue"
                        : "bg-apple-gray-100 text-apple-gray-600"
                    }`}
                  >
                    {selected.status || "new"}
                  </span>

                  {selected.createdAt && (
                    <span className="text-xs text-apple-gray-500">
                      Created: {new Date(selected.createdAt).toLocaleString()}
                    </span>
                  )}

                  {selected.readAt && (
                    <span className="text-xs text-apple-gray-500">
                      Read: {new Date(selected.readAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              <button
                className="px-3 py-2 rounded-xl bg-apple-gray-100 hover:bg-apple-gray-200 text-sm font-medium"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="text-sm">
                <span className="font-semibold text-apple-gray-900">Purpose: </span>
                <span className="text-apple-gray-700">{selected.purpose || "General"}</span>
              </div>

              {selected.phone && (
                <div className="text-sm">
                  <span className="font-semibold text-apple-gray-900">Phone: </span>
                  <span className="text-apple-gray-700">{selected.phone}</span>
                </div>
              )}

              {selected.address && (
                <div className="text-sm">
                  <span className="font-semibold text-apple-gray-900">Address: </span>
                  <span className="text-apple-gray-700">{selected.address}</span>
                </div>
              )}

              <div className="text-sm">
                <span className="font-semibold text-apple-gray-900">Rating: </span>
                <span className="text-apple-gray-700">
                  {selected.rating ? `${selected.rating}/5` : "—"}
                </span>
              </div>

              {selected?.location?.lat && selected?.location?.lng && (
                <div className="text-sm md:col-span-2">
                  <span className="font-semibold text-apple-gray-900">Location: </span>
                  <span className="text-apple-gray-700">
                    {selected.location.lat}, {selected.location.lng}
                  </span>
                  <a
                    className="ml-2 text-apple-blue underline"
                    href={toMapsLink(selected.location)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open map
                  </a>
                </div>
              )}
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold text-apple-gray-900 mb-2">Message</p>
              <div className="bg-white/60 border border-apple-gray-200 rounded-2xl p-4 text-apple-gray-800 whitespace-pre-wrap">
                {selected.message}
              </div>
            </div>

            {selected.attachmentUrl && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-apple-gray-900 mb-2">Attachment</p>
                <a
                  className="text-apple-blue underline text-sm"
                  href={selected.attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View uploaded file
                </a>

                {/* image preview (if it is an image url) */}
                <div className="mt-3">
                  <img
                    src={selected.attachmentUrl}
                    alt="attachment"
                    className="max-h-[320px] rounded-2xl border border-apple-gray-200 bg-white"
                  />
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              {(selected.status || "new") === "new" && (
                <button
                  onClick={() => markRead(selected._id)}
                  className="px-4 py-2 rounded-xl bg-blue-50 text-apple-blue text-sm font-semibold hover:bg-blue-100"
                >
                  Mark read
                </button>
              )}
              <button
                onClick={() => del(selected._id)}
                className="px-4 py-2 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}