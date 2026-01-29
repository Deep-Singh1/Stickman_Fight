package com.stickfight.backend;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class EchoHandler extends TextWebSocketHandler {

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        // Send a hello so we know it connected
        session.sendMessage(new TextMessage("{\"type\":\"hello\",\"msg\":\"connected\"}"));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        // Echo back what the client sent
        String payload = message.getPayload();
        String echo = "{\"type\":\"echo\",\"youSent\":" + payload + "}";
        session.sendMessage(new TextMessage(echo));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        // Optional: log or clean up
    }
}
