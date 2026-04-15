import axios from 'axios';

// Create an Axios instance
const apiCaller = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'https://api.getlabs.cloud',
    withCredentials: true, // Send cookies with requests if needed
});

// Add a request interceptor to include `uid` in the headers
apiCaller.interceptors.request.use(
    config => {
        // Retrieve the `uid` token from localStorage
        const uid = localStorage.getItem('uid');
        if (uid) {
            config.headers['Authorization'] = `Bearer ${uid}`; // Include token as a Bearer token
        }
        return config;
    },
    error => {
        // Handle errors in the request configuration
        return Promise.reject(error);
    }
);

// Add a response interceptor
apiCaller.interceptors.response.use(
    response => {
        // If the request is successful, just return the response
        return response;
    },
    error => {
        // If the error is a 401 Unauthorized, redirect to the login page
        if (error.response && error.response.status === 401) {
            // Use window.location to navigate since useNavigate doesn't work outside components
            window.location.href = '/logout';
        }
        // For other errors, you might want to handle them differently
        return Promise.reject(error);
    }
);

export default apiCaller;
