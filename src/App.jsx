// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { db } from "./firebase";
import {
  ref,
  push,
  set,
  onChildAdded,
  onValue,
  remove,
  onDisconnect,
  query,
  limitToLast,
} from "firebase/database";
import { v4 as uuidv4 } from "uuid";
import "./App.css";

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [inRoom, setInRoom] = useState(false);
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState({});
  const [localText, setLocalText] = useState("");
  const [name, setName] = useState(
    () => "goatsloth-" + Math.random().toString(36).slice(2, 7)
  );

  const userIdRef = useRef(localStorage.getItem("chat_user_id") || uuidv4());
  const roomRef = useRef(null);
  const messagesRef = useRef(null);
  const participantsRef = useRef(null);
  const cleanupRef = useRef([]);
  const chatEndRef = useRef(null);

  // persist user id
  useEffect(() => {
    localStorage.setItem("chat_user_id", userIdRef.current);
  }, []);

  // auto scroll to bottom when messages change
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  // helper to cleanup firebase listeners
  function pushCleanup(fn) {
    cleanupRef.current.push(fn);
  }
  function runCleanup() {
    cleanupRef.current.forEach((fn) => {
      try {
        if (typeof fn === "function") fn();
      } catch {}
    });
    cleanupRef.current = [];
  }

  // create room
  async function createRoom() {
    const id = Math.random().toString(36).slice(2, 9);
    setRoomId(id);
    await set(ref(db, `rooms/${id}`), { createdAt: Date.now() });
    joinRoom(id);
  }

  // join room
  async function joinRoom(id) {
    if (!id) return alert("Enter room id");
    // if already in a room, cleanup previous
    if (inRoom) {
      await leaveRoom();
    }

    setRoomId(id);
    setInRoom(true);

    roomRef.current = ref(db, `rooms/${id}`);
    messagesRef.current = ref(db, `rooms/${id}/messages`);
    participantsRef.current = ref(db, `rooms/${id}/participants`);

    // presence: add participant
    const pRef = ref(
      db,
      `rooms/${id}/participants/${userIdRef.current}`
    );
    await set(pRef, {
      id: userIdRef.current,
      name,
      joinedAt: Date.now(),
    });

    // onDisconnect cleanup (best-effort)
    try {
      onDisconnect(pRef).remove();
    } catch {}

    // subscribe participants
    const unsubParticipants = onValue(participantsRef.current, (snap) => {
      const val = snap.val() || {};
      setParticipants(val);
    });
    pushCleanup(() => unsubParticipants && typeof unsubParticipants === "function" && unsubParticipants());

    // subscribe to latest messages (limit to last 200)
    const recentQuery = query(messagesRef.current, limitToLast(200));
    const unsubMessages = onChildAdded(recentQuery, (snap) => {
      const val = snap.val();
      if (!val) return;
      const msg = {
        id: snap.key,
        fromId: val.fromId,
        fromName: val.fromName,
        text: val.text,
        at: val.at,
      };
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    pushCleanup(() => unsubMessages && typeof unsubMessages === "function" && unsubMessages());

    // ensure room exists (create if removed)
    const unsubRoom = onValue(
      roomRef.current,
      (snap) => {
        if (!snap.exists()) {
          set(roomRef.current, { createdAt: Date.now() });
        }
      },
      { onlyOnce: true }
    );
    pushCleanup(() => unsubRoom && typeof unsubRoom === "function" && unsubRoom());

    // note: cleanupRef populated for leaveRoom / rejoin
  }

  // leave room
  async function leaveRoom() {
    if (!inRoom || !roomId) return;

    try {
      await remove(
        ref(db, `rooms/${roomId}/participants/${userIdRef.current}`)
      );
    } catch {}

    // cleanup listeners
    runCleanup();

    setInRoom(false);
    setMessages([]);
    setParticipants({});
    roomRef.current = null;
    messagesRef.current = null;
    participantsRef.current = null;
    setRoomId("");
  }

  // send message
  async function sendMessage() {
    if (!inRoom) {
      alert("Join a room to send messages.");
      return;
    }
    if (!localText.trim()) return;

    const mRef = push(ref(db, `rooms/${roomId}/messages`));
    try {
      await set(mRef, {
        fromId: userIdRef.current,
        fromName: name,
        text: localText.trim(),
        at: Date.now(),
      });
      setLocalText("");
    } catch (err) {
      console.error("sendMessage error:", err);
    }
  }

  // time string with short format
  function timeStr(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // initials helper
  function initialsFor(n) {
    if (!n) return "?";
    return n
      .trim()
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  return (
    <div className="gs-app" data-theme="light">
      <header className="gs-header" role="banner">
        <div className="gs-brand">
          <div className="gs-logo" aria-hidden="true">🐐🦥</div>
          <div>
            <h1 className="gs-title">GoatSloth</h1>
            <div className="gs-sub">Realtime chat — powered by Firebase</div>
          </div>
        </div>

        <div className="gs-controls">
          <label className="sr-only" htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            className="gs-input gs-input--sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your display name"
            aria-label="Display name"
            title="Your display name (only set on join)"
          />

          <button
            type="button"
            className="gs-btn"
            onClick={createRoom}
            disabled={inRoom}
            aria-disabled={inRoom}
            title="Create new room"
          >
            Create
          </button>

          <input
            className="gs-input gs-input--sm"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="room id"
            aria-label="Room ID"
          />
          <button
            type="button"
            className="gs-btn"
            onClick={() => joinRoom(roomId)}
            disabled={inRoom || !roomId}
            aria-disabled={inRoom || !roomId}
          >
            Join
          </button>

          <button
            type="button"
            className="gs-btn gs-btn--muted"
            onClick={leaveRoom}
            disabled={!inRoom}
            aria-disabled={!inRoom}
          >
            Leave
          </button>
        </div>
      </header>

      <main className="gs-main" role="main">
        <section
          className="gs-chat"
          aria-label={`Chat room ${roomId || "none"}`}
        >
          <div className="gs-chat-header">
            <div className="gs-chat-title">
              <strong>Chat</strong>
              <span className="gs-mono"> {roomId ? `• ${roomId}` : ""}</span>
            </div>
            <div className="gs-chat-meta">
              <div className="gs-part-count">{Object.keys(participants).length} online</div>
            </div>
          </div>

          <div className="gs-chat-box" role="log" aria-relevant="additions">
            {messages.length === 0 && (
              <div className="gs-empty">No messages yet — be the first to say hi 👋</div>
            )}

            {messages.map((m) => {
              const mine = m.fromId === userIdRef.current;
              return (
                <div
                  key={m.id}
                  className={`gs-msg-row ${mine ? "gs-msg-row--me" : "gs-msg-row--peer"}`}
                >
                  {!mine && (
                    <div className="gs-avatar" aria-hidden="true">
                      {initialsFor(m.fromName)}
                    </div>
                  )}

                  <div className="gs-msg">
                    <div className="gs-msg-meta">
                      <span className="gs-msg-sender">{mine ? "You" : m.fromName}</span>
                      <span className="gs-msg-time">{timeStr(m.at)}</span>
                    </div>
                    <div className="gs-msg-body">{m.text}</div>
                  </div>

                  {mine && <div className="gs-avatar gs-avatar--spacer" aria-hidden="true" />}
                </div>
              );
            })}

            <div ref={chatEndRef} />
          </div>

          <form
            className="gs-composer"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            aria-label="Message composer"
          >
            <input
              className="gs-input gs-input--composer"
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              placeholder={inRoom ? "Type a message…" : "Join a room to send messages"}
              disabled={!inRoom}
              aria-disabled={!inRoom}
            />
            <button
              type="submit"
              className="gs-btn gs-btn--primary"
              disabled={!inRoom || !localText.trim()}
              aria-disabled={!inRoom || !localText.trim()}
            >
              Send
            </button>
          </form>
        </section>

        <aside className="gs-participants" aria-label="Participants">
          <div className="gs-part-head">
            <strong>Participants</strong>
            <span className="gs-muted">({Object.keys(participants).length})</span>
          </div>

          <div className="gs-part-list">
            {Object.keys(participants).length === 0 && (
              <div className="gs-empty">No users online</div>
            )}

            <ul>
              {Object.values(participants).map((p) => (
                <li key={p.id} className="gs-part">
                  <div className="gs-avatar">{initialsFor(p.name)}</div>
                  <div className="gs-part-info">
                    <div className="gs-part-name">{p.name}</div>
                    <div className="gs-part-sub">{p.id === userIdRef.current ? "you" : "peer"}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
