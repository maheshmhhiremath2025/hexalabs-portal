import React, { useState, useRef, useEffect } from 'react';
import { FaTimes, FaPaperPlane, FaCommentDots } from 'react-icons/fa';
import apiCaller from '../services/apiCaller.jsx';

export default function LabChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', text };
    setMessages(prev => [...prev.slice(-9), userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await apiCaller.post('/selfservice/chat', { message: text });
      const botMsg = { role: 'bot', text: res.data.response };
      setMessages(prev => [...prev.slice(-9), botMsg]);
    } catch (err) {
      const errText = err.response?.data?.error || 'Something went wrong. Please try again.';
      setMessages(prev => [...prev.slice(-9), { role: 'bot', text: errText }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 flex items-center justify-center transition-colors"
        title="Lab Help"
      >
        <FaCommentDots className="text-xl" />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
      style={{ width: 350, height: 450 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white shrink-0">
        <div>
          <div className="text-sm font-semibold">Lab Assistant</div>
          <div className="text-xs opacity-80">Ask about your cloud labs</div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="w-7 h-7 rounded-md hover:bg-blue-500 flex items-center justify-center transition-colors"
        >
          <FaTimes className="text-sm" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-gray-50">
        {messages.length === 0 && !loading && (
          <div className="text-center text-gray-400 text-xs mt-8">
            <p className="mb-2 text-sm font-medium text-gray-500">How can I help?</p>
            <p>Ask about lab access, cloud concepts, error messages, or lab exercises.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-800'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-200 text-gray-600 rounded-lg px-3 py-2 text-sm">
              Thinking<span className="animate-pulse">...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-gray-200 bg-white shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your question..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="w-9 h-9 bg-blue-600 text-white rounded-lg flex items-center justify-center disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            <FaPaperPlane className="text-xs" />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1 text-center">Powered by AI</p>
      </div>
    </div>
  );
}
