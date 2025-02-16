# Real-Time Chat Application

A real-time chat application built with Node.js + NestJS (Socket.io, Redis) on the server side and React (Socket.io client) on the client side.

## Features

- Multiple rooms
- Real-time messaging using Socket.io
- Message persistence in Redis (loading the last 10 messages on join)
- Typing indicators
- Private messaging (username → socket mapping stored in Redis)
- Pagination for older messages
- Simple authentication mechanism via usernames (no passwords)

## Prerequisites

1. Node.js (preferably latest LTS version 22.14.0)
2. Package manager of your choice (npm, yarn, or pnpm)
3. Docker (for containerization)

## Project Structure
```
my-realtime-chat/
├─ server
│ ├─ src
│ │ ├─ adapters
│ │ │ └─ redis-io.adapter.ts
│ │ ├─ chat
│ │ │ ├─ chat.gateway.ts
│ │ │ ├─ chat.module.ts
│ │ │ └─ chat.service.ts
│ │ ├─ app.module.ts
│ │ └─ main.ts
│ ├─ package.json
│ └─ tsconfig.json
└─ client
├─ src
│ ├─ App.tsx
│ └─ index.tsx
├─ package.json
└─ tsconfig.json
```

## Installation & Setup

### Clone / Download the Repository

```bash
git clone https://github.com/ArditZubaku/my-realtime-chat.git
```

### Build and Run

```bash
docker compose up --build
```

## Usage

1. Open the client in your browser (http://localhost:8080)
2. Join the chat by entering:
   - A username (simple ID)
   - A room name (e.g., "General" or "MyRoom123")
3. Send messages in real time, and other users in the same room will receive them instantly
4. Typing indicators: When you focus the message input, a typing event notifies other users
5. Private messaging: Input a recipient's username (exact match) and a message; it is sent only to that user, with both messages stored in Redis
6. Load older messages (pagination): Click the "Load Older Messages" button to fetch older pages from Redis, prepending them to the chat history

## Design Decisions

### NestJS + Socket.io
We chose NestJS for a structured, modular approach. Socket.io provides robust, real-time bi-directional communication, ideal for chat.

### Redis
Used as both a pub/sub adapter for Socket.io (enabling horizontal scaling) and a persistent store for chat messages:
- `room:<roomName>` lists for group messages
- `user_sockets:<username>` for user→socket ID mapping, enabling direct messages
- `PM:<from>:<to>` lists for private messaging

### TypeScript
Ensures strong typing, clearer interfaces, and safer refactoring.

### React
A simple UI with minimal styling focusing on essential features (real-time messaging, private chats, pagination). The app listens for relevant Socket.io events (e.g., `receive_message`, `receive_private_message`) and updates the UI accordingly.

### Simple Authentication by Username
The requirement only specified an easy mechanism to identify users. We store username in the socket and in Redis. For production, a more sophisticated system with tokens and password checks would be needed.

## Error Handling

### Client-Side Error Handling
- Visual error notifications with auto-dismissing toast messages
- Connection status indicator showing current state (Connected/Connecting/Disconnected)
- Automatic disabling of inputs when disconnected
- Clear feedback for failed operations (messages, private messages)
- Visual feedback for connection state in the UI
- Automatic reconnection attempts with user notification
- Input validation with user-friendly error messages
- Graceful handling of offline states

### Socket Connection
- Connection failures trigger automatic reconnection attempts by Socket.io
- Client displays connection status and reconnection attempts to users
- Server logs failed connection attempts and disconnections
- Proper cleanup of resources on disconnection
- Handling of connection errors with user feedback
- Socket error event handling and logging

### Redis Connection
- Redis adapter implements connection retry logic with exponential backoff
- Configurable retry attempts and timeout settings
- Connection event monitoring (connect, error, reconnecting)
- Graceful shutdown with proper cleanup
- Detailed error logging with NestJS Logger
- Proper error propagation to clients
- Separate handling for pub/sub client errors

### Message Delivery
- Failed message deliveries are reported back to the sender
- Messages are stored in Redis before acknowledgment
- Undelivered messages can be retrieved when connection is restored
- Validation of message format and content
- Error handling for message parsing and storage
- Proper error feedback for failed message delivery

### User Authentication
- Duplicate usernames are rejected with clear error messages
- Invalid room names or message formats trigger validation errors
- Users are notified when their session expires or is terminated
- Input validation on both client and server side
- Clear error messages for authentication failures
- Proper cleanup of user sessions on disconnection

### Error Logging and Monitoring
- Structured error logging using NestJS Logger
- Different log levels for different types of errors
- Detailed error context in logs
- Client-side error logging to console
- Error tracking with timestamps
- Separate handling for different error types