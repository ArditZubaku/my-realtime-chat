import React, { useEffect, useState, useRef, JSX } from 'react';
import { io, Socket } from 'socket.io-client';

interface ChatMessage {
  sender: string;
  room: string;
  message: string;
  timestamp: number;
}

interface PrivateMessage {
  from: string;
  message: string;
  timestamp: number;
}

interface ErrorMessage {
  message: string;
  timestamp: number;
}

const SERVER_URL = import.meta.env.VITE_API_URL || 'VITE_API_URL_PLACEHOLDER';

function App(): JSX.Element {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('');
  const [joined, setJoined] = useState(false);

  // Group chat messages + new message input
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');

  // Typing
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // Private messaging
  const [recipient, setRecipient] = useState('');
  const [privateMsg, setPrivateMsg] = useState('');
  const [privateInbox, setPrivateInbox] = useState<PrivateMessage[]>([]);

  // Pagination
  const [pageIndex, setPageIndex] = useState(0);

  const [errors, setErrors] = useState<ErrorMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!joined) return;

    setConnectionStatus('connecting');
    const socket = io(`${SERVER_URL}/chat`);
    socketRef.current = socket;

    // Connection handling
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setConnectionStatus('connected');
      socket.emit('join_room', { username, room });
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setConnectionStatus('disconnected');
      addError('Failed to connect to chat server');
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnectionStatus('disconnected');
      addError('Disconnected from chat server');
    });

    // Error handling
    socket.on('error', (error: { message: string }) => {
      addError(error.message);
    });

    // Last 10 messages
    socket.on('last_messages', (msgs: ChatMessage[]) => {
      setMessages(msgs);
      setPageIndex(0); // reset pagination
    });

    // Receive broadcast
    socket.on('receive_message', (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    });

    // Typing indicator
    socket.on('user_typing', (data: { username: string; isTyping: boolean }) => {
      const { username: typingUser, isTyping } = data;
      // Don't show typing indicator for your own username (try it by opening same username in different clients)
      if (typingUser === username) {
        return;
      }
      
      setTypingUsers((prev) => {
        if (isTyping) {
          return prev.includes(typingUser) ? prev : [...prev, typingUser];
        }
        return prev.filter((u) => u !== typingUser);
      });
    });

    // Private messaging
    socket.on('receive_private_message', (pm) => {
      console.log('Got private message:', pm);
      setPrivateInbox((prev) => [...prev, pm]);
    });

    // Pagination event: older_messages
    socket.on('older_messages', (older: ChatMessage[]) => {
      // Prepend them
      setMessages((prev) => [...older, ...prev]);
    });

    return () => {
      socket.disconnect();
    };
  }, [joined, username, room]);

  // Helper function to add errors with auto-removal after 5 seconds
  const addError = (message: string) => {
    const error: ErrorMessage = {
      message,
      timestamp: Date.now(),
    };
    setErrors((prev) => [...prev, error]);

    // Remove error after 5 seconds
    setTimeout(() => {
      setErrors((prev) => prev.filter((e) => e.timestamp !== error.timestamp));
    }, 5000);
  };

  // Join logic
  const handleJoin = () => {
    if (!username.trim() || !room.trim()) {
      alert('Please enter both username and room');
      return;
    }
    setJoined(true);
  };

  // Modified send message handler with error handling
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    if (!socketRef.current?.connected) {
      addError('Cannot send message: Not connected to server');
      return;
    }

    socketRef.current.emit('send_message', {
      username,
      room,
      message: newMessage.trim(),
    });
    setNewMessage('');
  };

  // Typing indicator
  const handleTyping = (isTyping: boolean) => {
    // Don't emit typing event for your own typing from other windows
    if (typingUsers.includes(username)) {
      return;
    }
    
    socketRef.current?.emit('typing', { username, room, isTyping });
  };

  // Modified private message handler with error handling
  const sendPrivateMessage = () => {
    if (!recipient.trim() || !privateMsg.trim()) {
      addError('Please enter both recipient and message');
      return;
    }

    if (!socketRef.current?.connected) {
      addError('Cannot send private message: Not connected to server');
      return;
    }

    socketRef.current.emit('send_private_message', {
      from: username,
      to: recipient,
      message: privateMsg,
    });
    setPrivateMsg('');
  };

  // Load older messages
  const loadOlder = () => {
    const nextPage = pageIndex + 1;
    setPageIndex(nextPage);
    socketRef.current?.emit('fetch_older_messages', {
      room,
      pageSize: 5,
      pageIndex: nextPage,
    });
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#333',
        margin: 0,
        padding: 0,
      }}
    >
      {/* Error Messages Display */}
      <div style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 1000,
      }}>
        {errors.map((error, index) => (
          <div
            key={index}
            style={{
              backgroundColor: '#ff4444',
              color: 'white',
              padding: '10px 20px',
              borderRadius: '4px',
              marginBottom: '10px',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              animation: 'slideIn 0.3s ease-out',
            }}
          >
            {error.message}
          </div>
        ))}
      </div>

      {/* Connection Status Indicator */}
      <div
        style={{
          position: 'fixed',
          top: 10,
          left: 10,
          padding: '5px 10px',
          borderRadius: '4px',
          backgroundColor: connectionStatus === 'connected' ? '#4CAF50' : connectionStatus === 'connecting' ? '#FFA500' : '#ff4444',
          color: 'white',
          fontSize: '12px',
        }}
      >
        {connectionStatus === 'connected' ? 'Connected' : connectionStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}
      </div>

      {!joined ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid #555',
            padding: '2rem',
            borderRadius: '8px',
            textAlign: 'center',
            backgroundColor: '#444',
            color: '#fff',
          }}
        >
          <h2 style={{ marginBottom: '1rem' }}>Join a Chat Room</h2>
          <input
            placeholder="Username"
            style={{
              width: '200px',
              padding: '0.5rem',
              marginBottom: '0.5rem',
              borderRadius: '4px',
              border: '1px solid #555',
              backgroundColor: '#222',
              color: '#fff',
            }}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            placeholder="Room"
            style={{
              width: '200px',
              padding: '0.5rem',
              marginBottom: '1rem',
              borderRadius: '4px',
              border: '1px solid #555',
              backgroundColor: '#222',
              color: '#fff',
            }}
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <button
            onClick={handleJoin}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#666',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Join
          </button>
        </div>
      ) : (
        // Chat UI
        <div
          style={{
            width: '80%',
            maxWidth: '600px',
            border: '1px solid #555',
            borderRadius: '8px',
            backgroundColor: '#444',
            display: 'flex',
            flexDirection: 'column',
            padding: '1rem',
            color: '#fff',
            position: 'relative',
          }}
        >
          <h3>Room: {room}</h3>
          <button
            onClick={loadOlder}
            style={{
              marginBottom: '1rem',
              padding: '0.3rem 0.8rem',
              borderRadius: '4px',
              backgroundColor: '#666',
              border: 'none',
              cursor: 'pointer',
              color: '#fff',
            }}
          >
            Load Older Messages
          </button>

          <div
            style={{
              border: '1px solid #777',
              height: '300px',
              overflowY: 'auto',
              marginBottom: '1rem',
              padding: '1rem',
              backgroundColor: '#222',
            }}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  marginBottom: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.sender === username ? 'flex-end' : 'flex-start'
                }}
              >
                <div style={{
                  backgroundColor: msg.sender === username ? '#0084ff' : '#3e4042',
                  padding: '8px 12px',
                  borderRadius: '18px',
                  maxWidth: '70%',
                  wordWrap: 'break-word'
                }}>
                  {msg.sender !== username && (
                    <strong style={{
                      display: 'block',
                      marginBottom: '4px',
                      fontSize: '0.9em',
                      color: '#ccc'
                    }}>
                      {msg.sender}
                    </strong>
                  )}
                  <span>{msg.message}</span>
                  <div style={{
                    fontSize: '0.7em',
                    marginTop: '4px',
                    color: msg.sender === username ? '#fff' : '#999',
                    textAlign: 'right'
                  }}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <div style={{ fontStyle: 'italic', marginBottom: '10px' }}>
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}

          {/* Disable inputs when disconnected */}
          <form onSubmit={handleSendMessage}>
            <input
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #555',
                backgroundColor: connectionStatus === 'connected' ? '#222' : '#444',
                color: '#fff',
                borderRadius: '4px',
              }}
              placeholder={connectionStatus === 'connected' ? 
                "Write a message" : "Disconnected..."}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onFocus={() => handleTyping(true)}
              onBlur={() => handleTyping(false)}
              disabled={connectionStatus !== 'connected'}
            />
          </form>

          {/* Private Messaging UI */}
          <div style={{ border: '1px solid #555', padding: '10px', backgroundColor: '#333' }}>
            <h4>Private Messages</h4>
            <input
              style={{
                display: 'block',
                marginBottom: '8px',
                width: '100%',
                padding: '6px',
                border: '1px solid #555',
                backgroundColor: '#222',
                color: '#fff',
                borderRadius: '4px',
              }}
              placeholder={connectionStatus === 'connected' ? 
                "Recipient Username" : "Disconnected..."}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={connectionStatus !== 'connected'}
            />
            <input
              style={{
                display: 'block',
                marginBottom: '8px',
                width: '100%',
                padding: '6px',
                border: '1px solid #555',
                backgroundColor: '#222',
                color: '#fff',
                borderRadius: '4px',
              }}
              placeholder={connectionStatus === 'connected' ? 
                "Message" : "Disconnected..."}
              value={privateMsg}
              onChange={(e) => setPrivateMsg(e.target.value)}
              disabled={connectionStatus !== 'connected'}
            />
            <button
              onClick={sendPrivateMessage}
              style={{
                marginBottom: '8px',
                padding: '0.3rem 0.8rem',
                borderRadius: '4px',
                backgroundColor: '#666',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
                opacity: connectionStatus === 'connected' ? 1 : 0.5,
              }}
              disabled={connectionStatus !== 'connected'}
            >
              Send Private
            </button>

            <div
              style={{
                border: '1px solid #777',
                padding: '5px',
                height: '100px',
                overflowY: 'auto',
                backgroundColor: '#222',
              }}
            >
              <h5>Incoming PMs</h5>
              {privateInbox.map((pm, idx) => (
                <div key={idx}>
                  <strong>{pm.from}</strong>: {pm.message}{' '}
                  <small style={{ color: '#999' }}>
                    {new Date(pm.timestamp).toLocaleTimeString()}
                  </small>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Some basic CSS animation for error messages
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;
document.head.appendChild(style);

export default App;
