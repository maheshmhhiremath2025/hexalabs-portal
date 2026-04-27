import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FaHeadset,
  FaPhone,
  FaEnvelope,
  FaClock,
  FaWhatsapp,
  FaTelegram,
  FaTicketAlt,
  FaBook,
  FaVideo,
  FaFileAlt,
  FaSearch,
  FaArrowRight,
  FaExternalLinkAlt,
  FaUserFriends,
  FaShieldAlt,
  FaRocket
} from 'react-icons/fa';

const SupportPage = () => {
  const [activeTab, setActiveTab] = useState('contact');
  const [searchQuery, setSearchQuery] = useState('');

  // FAQ data
  const faqCategories = [
    {
      id: 'general',
      title: 'General Questions',
      icon: FaUserFriends,
      questions: [
        {
          question: 'How do I reset my password?',
          answer: 'You can reset your password by clicking on "Forgot Password" on the login page. A reset link will be sent to your registered email address.'
        },
        {
          question: 'How do I deploy a new VM instance?',
          answer: 'Navigate to "Instance Overview" → "Deploy VM" in the sidebar. Follow the step-by-step wizard to configure and launch your virtual machine.'
        },
        {
          question: 'What are the system requirements?',
          answer: 'Our platform works on modern browsers (Chrome, Firefox, Safari, Edge). For optimal performance, we recommend 8GB RAM and a stable internet connection.'
        }
      ]
    },
    {
      id: 'billing',
      title: 'Billing & Payments',
      icon: FaFileAlt,
      questions: [
        {
          question: 'How is billing calculated?',
          answer: 'Billing is calculated based on instance hours, storage usage, and network bandwidth. You can view detailed breakdowns in the Cost Analysis section.'
        },
        {
          question: 'Can I get an invoice for my payments?',
          answer: 'Yes, all invoices are available in the Invoices section. You can download PDF copies for your records.'
        },
        {
          question: 'What payment methods do you accept?',
          answer: 'We accept major credit cards, PayPal, and bank transfers for enterprise customers.'
        }
      ]
    },
    {
      id: 'technical',
      title: 'Technical Support',
      icon: FaShieldAlt,
      questions: [
        {
          question: 'My instance is not starting up',
          answer: 'Check the instance status in Lab Console. If issues persist, try rebooting or check the activity logs for error messages.'
        },
        {
          question: 'How do I configure networking?',
          answer: 'Use the Networking section under Instance Overview to configure ports, security groups, and network settings.'
        },
        {
          question: 'Can I scale my instances?',
          answer: 'Yes, you can scale instances vertically (upgrade resources) or horizontally (add more instances) through the Operations section.'
        }
      ]
    }
  ];

  // Contact methods with functional links
  const contactMethods = [
    {
      icon: FaPhone,
      title: 'Phone Support',
      description: '24/7 dedicated support line',
      details: '+91 90354 06484 / +91 88849 07660',
      availability: '24/7',
      action: 'Call Now',
      color: 'from-blue-500 to-cyan-500',
      link: 'tel:+919035406484',
      secondaryLink: 'tel:+918884907660'
    },
    {
      icon: FaWhatsapp,
      title: 'WhatsApp',
      description: 'Quick chat support',
      details: '+91 90354 06484 / +91 88849 07660',
      availability: '24/7',
      action: 'Start Chat',
      color: 'from-green-500 to-emerald-500',
      link: 'https://wa.me/919035406484',
      secondaryLink: 'https://wa.me/918884907660'
    },
    {
      icon: FaTelegram,
      title: 'Telegram',
      description: 'Instant messaging',
      details: '@cloudsupport',
      availability: '24/7',
      action: 'Message Us',
      color: 'from-blue-400 to-cyan-400',
      link: 'https://t.me/cloudsupport'
    },
    {
      icon: FaEnvelope,
      title: 'Email Support',
      description: 'Detailed technical assistance',
      details: 'itops@synergificsoftware.com',
      availability: '24/7',
      action: 'Send Email',
      color: 'from-purple-500 to-pink-500',
      link: 'mailto:itops@synergificsoftware.com'
    }
  ];

  // Resources
  const resources = [
    {
      icon: FaBook,
      title: 'Documentation',
      description: 'Comprehensive guides and API references',
      link: 'https://docs.synergificsoftware.com',
      category: 'Learning'
    },
    {
      icon: FaVideo,
      title: 'Video Tutorials',
      description: 'Step-by-step video guides',
      link: 'https://youtube.com/synergific',
      category: 'Learning'
    },
    {
      icon: FaFileAlt,
      title: 'Knowledge Base',
      description: 'Articles and troubleshooting guides',
      link: 'https://help.synergificsoftware.com',
      category: 'Self-Help'
    },
    {
      icon: FaRocket,
      title: 'Quick Start Guide',
      description: 'Get up and running in 10 minutes',
      link: 'https://docs.synergificsoftware.com/quickstart',
      category: 'Learning'
    }
  ];

  // Filter FAQs based on search
  const filteredFaqs = faqCategories.map(category => ({
    ...category,
    questions: category.questions.filter(q => 
      q.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.answer.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(category => category.questions.length > 0);

  // Function to handle contact actions - opens in same window
  const handleContactAction = (method) => {
    if (method.link) {
      // For tel: and mailto: links, we can use window.location
      if (method.link.startsWith('tel:') || method.link.startsWith('mailto:')) {
        window.location.href = method.link;
      } else {
        // For web links, open in same tab
        window.location.href = method.link;
      }
    }
  };

  // Function to handle resource links
  const handleResourceClick = (link) => {
    window.location.href = link;
  };

  // Function to handle secondary contact actions
  const handleSecondaryAction = (link) => {
    window.location.href = link;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="p-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl">
              <FaHeadset className="text-white text-2xl" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900">Support Center</h1>
          </div>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Get help with your cloud portal, technical issues, billing questions, and more.
          </p>
        </motion.div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12"
        >
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 rounded-xl">
                <FaClock className="text-green-600 text-xl" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">24/7 Support</h3>
                <p className="text-gray-600">Always here to help</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-xl">
                <FaTicketAlt className="text-blue-600 text-xl" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Quick Response</h3>
                <p className="text-gray-600">Under 15 minutes</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-100">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-purple-100 rounded-xl">
                <FaUserFriends className="text-purple-600 text-xl" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Expert Team</h3>
                <p className="text-gray-600">Cloud specialists</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Navigation Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex flex-wrap gap-2 mb-8 justify-center"
        >
          {[
            { id: 'contact', label: 'Contact Support', icon: FaHeadset },
            { id: 'faq', label: 'FAQ', icon: FaBook },
            { id: 'resources', label: 'Resources', icon: FaFileAlt }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <tab.icon className="text-sm" />
              {tab.label}
            </button>
          ))}
        </motion.div>

        {/* Tab Content */}
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Contact Tab */}
          {activeTab === 'contact' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="p-8"
            >
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">Get in Touch</h2>
                <p className="text-gray-600 text-lg">
                  Choose your preferred method to contact our support team
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {contactMethods.map((method, index) => (
                  <motion.div
                    key={method.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-6 border border-gray-200 hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-xl bg-gradient-to-r ${method.color}`}>
                        <method.icon className="text-white text-xl" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">{method.title}</h3>
                        <p className="text-gray-600 mb-3">{method.description}</p>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{method.details}</p>
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <FaClock className="text-xs" />
                              {method.availability}
                            </p>
                          </div>
                          <button 
                            onClick={() => handleContactAction(method)}
                            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg text-sm font-medium hover:shadow-lg transition-all duration-200"
                          >
                            {method.action}
                          </button>
                        </div>
                        {method.secondaryLink && (
                          <div className="mt-2">
                            <button 
                              onClick={() => handleSecondaryAction(method.secondaryLink)}
                              className="text-xs text-blue-600 hover:text-blue-700 underline"
                            >
                              Try alternate number
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Emergency Support */}
              <div className="bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl p-6 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold mb-2">🚨 Emergency Support</h3>
                    <p className="opacity-90">Critical system issues and downtime</p>
                  </div>
                  <button 
                    onClick={() => handleSecondaryAction('tel:+918884907660')}
                    className="px-6 py-3 bg-white text-red-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors duration-200"
                  >
                    Emergency Line
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* FAQ Tab */}
          {activeTab === 'faq' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="p-8"
            >
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">Frequently Asked Questions</h2>
                <p className="text-gray-600 text-lg mb-6">
                  Find quick answers to common questions
                </p>
                
                {/* Search Bar */}
                <div className="max-w-2xl mx-auto relative">
                  <FaSearch className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search FAQs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {filteredFaqs.length > 0 ? (
                <div className="space-y-6">
                  {filteredFaqs.map((category, categoryIndex) => (
                    <motion.div
                      key={category.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: categoryIndex * 0.1 }}
                      className="bg-gray-50 rounded-2xl p-6"
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-white rounded-lg shadow-sm">
                          <category.icon className="text-blue-600 text-lg" />
                        </div>
                        <h3 className="text-xl font-semibold text-gray-900">{category.title}</h3>
                      </div>
                      <div className="space-y-4">
                        {category.questions.map((faq, faqIndex) => (
                          <motion.div
                            key={faqIndex}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3, delay: categoryIndex * 0.1 + faqIndex * 0.05 }}
                            className="bg-white rounded-xl p-4 border border-gray-200 hover:shadow-md transition-shadow duration-200"
                          >
                            <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                              <FaArrowRight className="text-blue-500 text-sm" />
                              {faq.question}
                            </h4>
                            <p className="text-gray-600 text-sm leading-relaxed">{faq.answer}</p>
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <FaSearch className="text-gray-400 text-4xl mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">No results found</h3>
                  <p className="text-gray-600">Try different search terms or contact support directly.</p>
                </div>
              )}
            </motion.div>
          )}

          {/* Resources Tab */}
          {activeTab === 'resources' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="p-8"
            >
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">Learning Resources</h2>
                <p className="text-gray-600 text-lg">
                  Explore our documentation and tutorials to master the platform
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                {resources.map((resource, index) => (
                  <motion.div
                    key={resource.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-6 border border-gray-200 hover:shadow-lg transition-all duration-300 group cursor-pointer"
                    onClick={() => handleResourceClick(resource.link)}
                  >
                    <div className="flex items-start gap-4">
                      <div className="p-3 bg-blue-100 rounded-xl group-hover:bg-blue-200 transition-colors duration-200">
                        <resource.icon className="text-blue-600 text-xl" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{resource.title}</h3>
                          <span className="text-xs font-medium px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                            {resource.category}
                          </span>
                        </div>
                        <p className="text-gray-600 text-sm mb-4">{resource.description}</p>
                        <div className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm group/link">
                          Access Resource
                          <FaExternalLinkAlt className="text-xs group-hover/link:translate-x-1 transition-transform duration-200" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Additional Help Section */}
              <div className="mt-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl p-8 text-white">
                <div className="text-center">
                  <h3 className="text-2xl font-bold mb-4">Still Need Help?</h3>
                  <p className="text-blue-100 mb-6 text-lg">
                    Our support team is ready to assist you with any questions
                  </p>
                  <div className="flex flex-wrap gap-4 justify-center">
                    <button 
                      onClick={() => handleSecondaryAction('tel:+918884907660')}
                      className="px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors duration-200 flex items-center gap-2"
                    >
                      <FaTicketAlt />
                      Call Support Now
                    </button>
                    <button 
                      onClick={() => handleSecondaryAction('https://wa.me/918884907660')}
                      className="px-6 py-3 bg-transparent border-2 border-white text-white rounded-lg font-semibold hover:bg-white hover:text-blue-600 transition-colors duration-200 flex items-center gap-2"
                    >
                      <FaHeadset />
                      WhatsApp Support
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center mt-12"
        >
          <div className="bg-white rounded-2xl p-8 shadow-lg border border-gray-100">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Ready to Get Help?</h3>
            <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
              Our dedicated support team is available 24/7 to ensure your cloud experience is seamless and productive.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <button 
                onClick={() => handleSecondaryAction('tel:+918884907660')}
                className="px-8 py-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-semibold hover:shadow-lg transition-all duration-200 flex items-center gap-3"
              >
                <FaHeadset />
                Contact Support Now
              </button>
              <button 
                onClick={() => handleResourceClick('https://docs.synergificsoftware.com')}
                className="px-8 py-4 bg-white text-gray-700 border border-gray-300 rounded-xl font-semibold hover:bg-gray-50 transition-all duration-200 flex items-center gap-3"
              >
                <FaBook />
                Browse Documentation
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default SupportPage;