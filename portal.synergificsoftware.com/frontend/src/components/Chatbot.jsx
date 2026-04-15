// src/components/SmartChatbot.jsx
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { 
  FaRobot, FaTimes, FaPaperPlane, FaUser, FaHeadset,
  FaHome, FaTachometerAlt, FaLaptop, FaServer, FaCreditCard,
  FaFileAlt, FaCog, FaCloud, FaUsers, FaSearch, FaLightbulb,
  FaBook, FaVideo, FaDownload, FaChartLine, FaShieldAlt,
  FaNetworkWired, FaDatabase, FaCogs, FaQuestionCircle,
  FaArrowRight, FaRegSmile, FaRegClock, FaSync, FaEllipsisH,
  FaPlay, FaStop, FaRedo, FaWifi, FaMoneyBillWave, FaFileInvoiceDollar,
  FaMicrophone, FaImage, FaLink, FaBolt, FaCrown
} from 'react-icons/fa';

// Helper component to render formatted text with bold styling
const FormattedText = ({ text }) => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const boldText = part.slice(2, -2);
          return <strong key={index} className="font-semibold text-gray-900">{boldText}</strong>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
};

const SmartChatbot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const location = useLocation();

  // Comprehensive Answer Database - NO MORE GENERIC RESPONSES
  const answerDatabase = {
    // VM Management Questions
    'how to start vm': {
      answer: `Starting a VM Instance:\n\n1. Go to Instance Overview → Lab Console\n2. Find your VM in the instances list\n3. Click the Start button (green play icon) next to your instance\n4. Wait for status to change from "Stopped" to "Running"\n5. Once running, you can access it via console or SSH`,
      type: 'guide',
      actions: ['Open Lab Console', 'View Documentation', 'Troubleshoot Startup'],
      icon: FaPlay
    },
    'how to stop vm': {
      answer: `Stopping a VM Instance:\n\n1. Navigate to Instance Overview → Lab Console\n2. Locate your running VM\n3. Click the Stop button (red square icon)\n4. Confirm the shutdown if prompted\n5. Instance status will change to "Stopped"\n\nNote: Stopping preserves your data but stops billing for compute resources`,
      type: 'guide',
      actions: ['Open Lab Console', 'Cost Savings Tips', 'Schedule Auto-stop'],
      icon: FaStop
    },
    'how to restart vm': {
      answer: `Restarting a VM Instance:\n\n1. Go to Instance Overview → Lab Console\n2. Find your VM instance\n3. Click the Restart button (circular arrow icon)\n4. This performs a graceful reboot\n5. Wait 1-2 minutes for full restart\n\nSoft Reboot maintains all services and connections`,
      type: 'guide',
      actions: ['Open Lab Console', 'Force Restart', 'Check Logs'],
      icon: FaRedo
    },
    'vm not starting': {
      answer: `Troubleshooting VM Startup Issues:\n\nQuick Checks:\n• Verify instance status in Lab Console\n• Check if you have sufficient quota\n• Review recent activity logs\n• Ensure network configuration is correct\n\nSolutions:\n1. Try stopping and starting again\n2. Check resource allocation\n3. Verify operating system image\n4. Contact support if persistent`,
      type: 'troubleshoot',
      actions: ['Check Instance Status', 'View Activity Logs', 'Contact Support'],
      icon: FaLaptop
    },

    // Billing Questions
    'billing question': {
      answer: `Billing & Cost Management:\n\nCost Components:\n• Instance hours (compute resources)\n• Storage (GB per month)\n• Network bandwidth\n• Additional services\n\nCost Control:\n• Use Cost Analysis for detailed breakdown\n• Set up budget alerts\n• Schedule non-production instances\n• Right-size your instances\n\nInvoices: Available in Ledger section`,
      type: 'info',
      actions: ['Open Cost Analysis', 'View Invoices', 'Set Budget'],
      icon: FaMoneyBillWave
    },
    'how to check costs': {
      answer: `Checking Your Costs:\n\n1. Go to Instance Overview → Cost Analysis\n2. View real-time spending dashboard\n3. Filter by date range, services, or instances\n4. Download detailed reports as PDF/CSV\n5. Set up cost alerts for budget tracking\n\nPro Tip: Monitor daily spending trends in the Dashboard`,
      type: 'guide',
      actions: ['Open Cost Analysis', 'Download Report', 'Set Alerts'],
      icon: FaChartLine
    },
    'download invoice': {
      answer: `Downloading Invoices:\n\n1. Navigate to Ledger section\n2. Select your desired billing period\n3. Click the Download button next to any invoice\n4. Choose PDF or CSV format\n5. Save for your records\n\nAll invoices are available from your start date`,
      type: 'guide',
      actions: ['Open Ledger', 'View Payment History', 'Export Data'],
      icon: FaFileInvoiceDollar
    },

    // Deployment Questions
    'how to deploy vm': {
      answer: `Deploying a New VM:\n\nStep-by-Step:\n1. Go to Instance Overview → Deploy VM\n2. Choose instance type (CPU, RAM, Storage)\n3. Select operating system image\n4. Configure networking and security\n5. Set resource limits and auto-scaling\n6. Review and launch\n\nDeployment takes 1-3 minutes typically`,
      type: 'guide',
      actions: ['Start Deployment', 'Instance Type Guide', 'Cost Estimation'],
      icon: FaServer
    },
    'create new instance': {
      answer: `Creating a New Instance:\n\nProcess:\n1. Access Deploy VM from sidebar\n2. Fill in instance details:\n   - Name and description\n   - Compute resources\n   - Storage requirements\n   - Network settings\n3. Configure security groups\n4. Launch and monitor progress\n\nBest Practice: Start with smaller instances and scale as needed`,
      type: 'guide',
      actions: ['Deploy VM', 'Resource Calculator', 'Templates'],
      icon: FaServer
    },

    // Networking Questions
    'network configuration': {
      answer: `Network Configuration:\n\nAvailable Settings:\n• Port forwarding rules\n• Security groups (firewall)\n• Network access controls\n• DNS configuration\n• Load balancing\n\nConfiguration:\n1. Go to Instance Overview → Networking\n2. Add/remove port rules\n3. Set up security groups\n4. Configure access controls\n\nSecurity: Always restrict access to necessary ports only`,
      type: 'info',
      actions: ['Open Networking', 'Add Port Rule', 'Security Guide'],
      icon: FaNetworkWired
    },
    'how to access vm': {
      answer: `Accessing Your VM:\n\nConnection Methods:\n\nWeb Console:\n1. Go to Lab Console\n2. Click "Console" tab on your instance\n3. Direct browser-based access\n\nSSH Access:\n1. Use provided IP address\n2. Connect via SSH client\n3. Use your credentials\n\nRemote Desktop:\n• Available for Windows instances\n• Use RDP client with instance IP`,
      type: 'guide',
      actions: ['Open Console', 'Get Connection Info', 'Troubleshoot Access'],
      icon: FaWifi
    },

    // General Questions
    'what is cloud portal': {
      answer: `Cloud Portal Overview:\n\nCloud Portal is your unified cloud management platform that provides:\n\n• VM Management - Deploy and manage virtual machines\n• Cost Control - Real-time billing and optimization\n• Networking - Secure network configuration\n• Monitoring - Performance and usage analytics\n• Sandbox Environments - Safe testing spaces\n\nPerfect for: Development, Testing, Training, and Production workloads`,
      type: 'info',
      actions: ['View Features', 'Quick Start Guide', 'Pricing Info'],
      icon: FaCloud
    },
    'get help': {
      answer: `Getting Help & Support:\n\nSupport Channels:\n\nImmediate Assistance:\nPhone: +91 88849 07660\nWhatsApp: +91 90354 06484\nEmail: itops@synergificsoftware.com\n\nSelf-Help:\n• This AI Assistant (me! 🤖)\n• Documentation and guides\n• Knowledge base articles\n• Video tutorials\n\n24/7 Support available for critical issues`,
      type: 'support',
      actions: ['Contact Support', 'Browse Docs', 'Video Tutorials'],
      icon: FaHeadset
    },

    // Technical Questions
    'check logs': {
      answer: `Checking Activity Logs:\n\nAccessing Logs:\n1. Go to Instance Overview → Activity Log\n2. Filter by date, instance, or event type\n3. Search specific events or errors\n4. Export logs for analysis\n\nWhat You Can Find:\n• Instance start/stop events\n• User actions and changes\n• System events and errors\n• Performance metrics\n• Security-related activities`,
      type: 'guide',
      actions: ['Open Activity Log', 'Search Events', 'Export Logs'],
      icon: FaFileAlt
    },
    'monitor performance': {
      answer: `Performance Monitoring:\n\nMonitoring Tools:\n\nDashboard:\n• Real-time resource usage\n• Performance trends\n• Cost vs performance\n\nInstance Level:\n• CPU/Memory utilization\n• Disk I/O performance\n• Network throughput\n• Application metrics\n\nAlerts: Set up notifications for performance thresholds`,
      type: 'info',
      actions: ['Open Dashboard', 'Set Alerts', 'Performance Tips'],
      icon: FaChartLine
    }
  };

  // Enhanced response generator that ALWAYS provides answers
  const generateSmartResponse = (userMessage) => {
    const lowerMessage = userMessage.toLowerCase().trim();
    
    // Direct match in database
    for (const [key, value] of Object.entries(answerDatabase)) {
      if (lowerMessage.includes(key)) {
        return value;
      }
    }

    // Fuzzy matching for common variations
    const fuzzyMatches = {
      // VM variations
      'start instance': answerDatabase['how to start vm'],
      'launch vm': answerDatabase['how to start vm'],
      'boot vm': answerDatabase['how to start vm'],
      'shutdown vm': answerDatabase['how to stop vm'],
      'turn off vm': answerDatabase['how to stop vm'],
      'reboot vm': answerDatabase['how to restart vm'],
      
      // Billing variations
      'cost question': answerDatabase['billing question'],
      'pricing': answerDatabase['billing question'],
      'how much': answerDatabase['billing question'],
      'invoice': answerDatabase['download invoice'],
      'billing info': answerDatabase['billing question'],
      
      // General variations
      'help': answerDatabase['get help'],
      'support': answerDatabase['get help'],
      'contact': answerDatabase['get help'],
      'what is this': answerDatabase['what is cloud portal'],
      'about portal': answerDatabase['what is cloud portal'],
    };

    for (const [key, value] of Object.entries(fuzzyMatches)) {
      if (lowerMessage.includes(key)) {
        return value;
      }
    }

    // If no match found, provide helpful guidance instead of generic response
    return {
      answer: `I want to give you the exact information you need! 🤖\n\nI can help you with:\n\n• VM Management - Starting, stopping, deploying instances\n• Billing & Costs - Cost analysis, invoices, budgeting\n• Networking - Port configuration, access setup\n• Technical Issues - Troubleshooting, performance, logs\n• General Help - Platform features, support channels\n\nTry asking:\n• "How do I start a VM?"\n• "How to check my costs?"\n• "Need help with networking"\n• Or describe exactly what you're trying to do!`,
      type: 'help',
      actions: ['VM Help', 'Billing Help', 'Technical Support', 'Contact Human'],
      icon: FaQuestionCircle
    };
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;

    // Add user message
    const userMessage = {
      id: Date.now(),
      text: inputMessage,
      isBot: false,
      timestamp: new Date(),
      type: 'user'
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');

    // Simulate typing
    setIsTyping(true);
    
    setTimeout(() => {
      const response = generateSmartResponse(inputMessage);
      const botMessage = {
        id: Date.now() + 1,
        text: response.answer,
        isBot: true,
        timestamp: new Date(),
        type: response.type,
        actions: response.actions,
        icon: response.icon
      };
      
      setMessages(prev => [...prev, botMessage]);
      setIsTyping(false);
    }, 1000);
  };

  const handleQuickAction = (action) => {
    // Map actions to actual functionality
    const actionMap = {
      'Open Lab Console': '/vm/vmdetails',
      'Open Cost Analysis': '/vm/billing',
      'Open Ledger': '/ledger',
      'Deploy VM': '/createvm',
      'Open Networking': '/vm/ports',
      'Open Console': '/vm/vmdetails',
      'Open Activity Log': '/vm/logs',
      'Open Dashboard': '/dashboard',
      'Contact Support': () => window.open('tel:+918884907660'),
      'Browse Docs': () => window.open('https://docs.synergificsoftware.com'),
      'View Documentation': () => window.open('https://docs.synergificsoftware.com'),
      'Video Tutorials': () => window.open('https://youtube.com/synergific'),
      'VM Help': () => handleQuickQuestion('how to start vm'),
      'Billing Help': () => handleQuickQuestion('billing question'),
      'Technical Support': () => handleQuickQuestion('get help'),
      'Contact Human': () => handleQuickQuestion('get help'),
      'Cost Savings Tips': () => handleQuickQuestion('billing question'),
      'Schedule Auto-stop': '/vm/settings',
      'Force Restart': () => handleQuickQuestion('how to restart vm'),
      'Check Logs': () => handleQuickQuestion('check logs'),
      'Set Budget': '/vm/billing',
      'Resource Calculator': '/createvm',
      'Templates': '/vm/templates',
      'Add Port Rule': '/vm/ports',
      'Security Guide': () => window.open('https://docs.synergificsoftware.com/security'),
      'Get Connection Info': '/vm/vmdetails',
      'Troubleshoot Access': () => handleQuickQuestion('how to access vm'),
      'View Features': '/dashboard',
      'Quick Start Guide': () => window.open('https://docs.synergificsoftware.com/quickstart'),
      'Pricing Info': '/vm/billing',
      'Search Events': '/vm/logs',
      'Export Logs': '/vm/logs',
      'Set Alerts': '/vm/monitoring',
      'Performance Tips': () => window.open('https://docs.synergificsoftware.com/performance'),
      'Check Instance Status': '/vm/vmdetails',
      'View Activity Logs': '/vm/logs',
      'Troubleshoot Startup': () => handleQuickQuestion('vm not starting')
    };

    if (typeof actionMap[action] === 'function') {
      actionMap[action]();
    } else if (actionMap[action]) {
      window.location.href = actionMap[action];
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Categories for organized quick actions
  const categories = [
    { id: 'all', name: 'All', icon: FaBolt },
    { id: 'vm', name: 'VM Management', icon: FaServer },
    { id: 'billing', name: 'Billing', icon: FaMoneyBillWave },
    { id: 'network', name: 'Networking', icon: FaNetworkWired },
    { id: 'support', name: 'Support', icon: FaHeadset }
  ];

  // Enhanced quick questions with categories
  const quickQuestions = [
    { text: "How to start VM?", action: "how to start vm", category: 'vm', icon: FaPlay },
    { text: "Check my costs", action: "how to check costs", category: 'billing', icon: FaChartLine },
    { text: "Deploy new instance", action: "how to deploy vm", category: 'vm', icon: FaServer },
    { text: "Network setup", action: "network configuration", category: 'network', icon: FaNetworkWired },
    { text: "Access my VM", action: "how to access vm", category: 'vm', icon: FaWifi },
    { text: "Download invoice", action: "download invoice", category: 'billing', icon: FaFileInvoiceDollar },
    { text: "Performance monitoring", action: "monitor performance", category: 'vm', icon: FaTachometerAlt },
    { text: "Get support", action: "get help", category: 'support', icon: FaHeadset },
    { text: "Restart VM", action: "how to restart vm", category: 'vm', icon: FaRedo },
    { text: "Check activity logs", action: "check logs", category: 'vm', icon: FaFileAlt }
  ];

  const filteredQuestions = activeCategory === 'all' 
    ? quickQuestions 
    : quickQuestions.filter(q => q.category === activeCategory);

  const handleQuickQuestion = (action) => {
    setInputMessage(action);
    setTimeout(handleSendMessage, 100);
  };

  const clearChat = () => {
    setMessages([]);
    // Add welcome message back
    const welcomeMessage = {
      id: Date.now(),
      text: `Welcome to Cloud Portal! I'm your AI assistant. I can help you with:\n\n• Step-by-step guides - VM deployment, management\n• Technical troubleshooting - Startup issues, performance\n• Cost optimization - Billing analysis, savings tips\n• Networking - Access configuration, security\n• And much more!\n\nAsk me anything specific - I'll give you detailed answers! 🤖`,
      isBot: true,
      timestamp: new Date(),
      type: 'welcome'
    };
    setMessages([welcomeMessage]);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        text: `Welcome to Cloud Portal! I'm your AI assistant. I can help you with:\n\n• Step-by-step guides - VM deployment, management\n• Technical troubleshooting - Startup issues, performance\n• Cost optimization - Billing analysis, savings tips\n• Networking - Access configuration, security\n• And much more!\n\nAsk me anything specific - I'll give you detailed answers! 🤖`,
        isBot: true,
        timestamp: new Date(),
        type: 'welcome'
      };
      setMessages([welcomeMessage]);
    }
  }, [isOpen]);

  return (
    <>
      {/* Enhanced Chat Bot Button */}
      <motion.button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 bg-primary-600 rounded-xl shadow-lg flex items-center justify-center text-white hover:bg-primary-700 transition-all duration-150"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <motion.div
          animate={{ rotate: [0, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 5 }}
        >
          <FaRobot className="text-base" />
        </motion.div>
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white"></div>
      </motion.button>

      {/* Enhanced Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-24 right-6 z-50 w-96 h-[560px] bg-white rounded-xl shadow-2xl border border-surface-200 flex flex-col overflow-hidden"
          >
            {/* Enhanced Header */}
            <div className="relative p-4 text-white bg-surface-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                      <FaRobot className="text-xl" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-current"></div>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Smart Assistant</h3>
                    <p className="text-xs opacity-90">Always online • Instant answers</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsMinimized(!isMinimized)}
                    className="w-8 h-8 rounded-lg bg-white/0 hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <motion.span
                      animate={{ rotate: isMinimized ? 180 : 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      {isMinimized ? '🗖' : '🗕'}
                    </motion.span>
                  </button>
                  <button
                    onClick={clearChat}
                    className="w-8 h-8 rounded-lg bg-white/0 hover:bg-white/20 flex items-center justify-center transition-colors text-sm"
                    title="Clear chat"
                  >
                    ↻
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="w-8 h-8 rounded-lg bg-white/0 hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <FaTimes />
                  </button>
                </div>
              </div>
            </div>

            {!isMinimized && (
              <>
                {/* Category Tabs */}
                <div className="px-4 pt-3 border-b border-gray-200/60">
                  <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
                    {categories.map((category) => (
                      <button
                        key={category.id}
                        onClick={() => setActiveCategory(category.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                          activeCategory === category.id
                            ? 'bg-blue-500 text-white shadow-sm'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <category.icon className="text-xs" />
                        {category.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Messages Container */}
                <div className="flex-1 p-4 overflow-y-auto bg-gradient-to-b from-gray-50/50 to-white">
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex ${message.isBot ? 'justify-start' : 'justify-end'}`}
                      >
                        <div className={`max-w-[85%] rounded-2xl p-4 relative ${
                          message.isBot 
                            ? 'bg-white border border-gray-200/80 shadow-sm' 
                            : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md'
                        }`}>
                          {/* Message Icon */}
                          {message.isBot && message.icon && (
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                                message.type === 'guide' ? 'bg-green-100 text-green-600' :
                                message.type === 'troubleshoot' ? 'bg-red-100 text-red-600' :
                                message.type === 'support' ? 'bg-purple-100 text-purple-600' :
                                'bg-blue-100 text-blue-600'
                              }`}>
                                <message.icon className="text-xs" />
                              </div>
                              <span className={`text-xs font-medium ${
                                message.type === 'guide' ? 'text-green-600' :
                                message.type === 'troubleshoot' ? 'text-red-600' :
                                message.type === 'support' ? 'text-purple-600' :
                                'text-blue-600'
                              }`}>
                                {message.type.charAt(0).toUpperCase() + message.type.slice(1)}
                              </span>
                            </div>
                          )}
                          
                          <p className="text-sm leading-relaxed">
                            <FormattedText text={message.text} />
                          </p>
                          
                          {message.actions && (
                            <div className="flex flex-wrap gap-2 mt-3">
                              {message.actions.map((action, index) => (
                                <motion.button
                                  key={index}
                                  whileHover={{ scale: 1.02 }}
                                  whileTap={{ scale: 0.98 }}
                                  onClick={() => handleQuickAction(action)}
                                  className={`text-xs rounded-lg px-3 py-1.5 transition-all font-medium ${
                                    message.isBot 
                                      ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60 shadow-sm'
                                      : 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm'
                                  }`}
                                >
                                  {action}
                                </motion.button>
                              ))}
                            </div>
                          )}
                          
                          <p className={`text-xs mt-2 ${
                            message.isBot ? 'text-gray-500' : 'text-blue-100'
                          }`}>
                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </motion.div>
                    ))}

                    {isTyping && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex justify-start"
                      >
                        <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-blue-600 rounded-lg flex items-center justify-center">
                              <FaRobot className="text-white text-sm" />
                            </div>
                            <div className="flex flex-col gap-2">
                              <div className="flex gap-1">
                                <motion.div
                                  className="w-2 h-2 bg-gray-400 rounded-full"
                                  animate={{ scale: [1, 1.2, 1] }}
                                  transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                                />
                                <motion.div
                                  className="w-2 h-2 bg-gray-400 rounded-full"
                                  animate={{ scale: [1, 1.2, 1] }}
                                  transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                                />
                                <motion.div
                                  className="w-2 h-2 bg-gray-400 rounded-full"
                                  animate={{ scale: [1, 1.2, 1] }}
                                  transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">Finding the best answer...</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Enhanced Quick Questions */}
                  {messages.length <= 2 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      className="mt-6 space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <FaLightbulb className="text-yellow-500 text-sm" />
                        <p className="text-xs font-semibold text-gray-700">Quick questions</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {filteredQuestions.slice(0, 6).map((q, index) => (
                          <motion.button
                            key={index}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => handleQuickQuestion(q.action)}
                            className="text-xs bg-white border border-gray-300/80 rounded-xl p-3 text-left hover:border-blue-300 hover:shadow-sm transition-all group"
                          >
                            <div className="flex items-center gap-2">
                              <q.icon className="text-blue-500 text-xs group-hover:scale-110 transition-transform" />
                              <span className="flex-1">{q.text}</span>
                            </div>
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Enhanced Input Area */}
                <div className="p-4 border-t border-gray-200/60 bg-white/80 backdrop-blur-sm">
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask me anything about Cloud Portal..."
                        className="w-full border border-gray-300/80 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 backdrop-blur-sm pr-10"
                      />
                      <button className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                        <FaRegSmile className="text-sm" />
                      </button>
                    </div>
                    <motion.button
                      onClick={handleSendMessage}
                      disabled={!inputMessage.trim() || isTyping}
                      whileHover={{ scale: !inputMessage.trim() || isTyping ? 1 : 1.05 }}
                      whileTap={{ scale: !inputMessage.trim() || isTyping ? 1 : 0.95 }}
                      className="w-10 h-10 bg-primary-600 text-white rounded-lg flex items-center justify-center disabled:opacity-40 disabled:bg-surface-400 hover:bg-primary-700 transition-colors"
                    >
                      <FaPaperPlane className="text-sm" />
                    </motion.button>
                  </div>
                  <div className="flex items-center justify-between mt-2 px-1">
                    <p className="text-xs text-gray-500">
                      Powered by AI • Instant cloud assistance
                    </p>
                    <div className="flex gap-2">
                      <button className="text-gray-400 hover:text-gray-600 transition-colors p-1">
                        <FaMicrophone className="text-xs" />
                      </button>
                      <button className="text-gray-400 hover:text-gray-600 transition-colors p-1">
                        <FaImage className="text-xs" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default SmartChatbot;