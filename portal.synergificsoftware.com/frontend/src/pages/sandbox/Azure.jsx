import React, { useEffect, useState } from "react";
import apiCaller from "../../services/apiCaller";

const Azure = ({ apiRoutes }) => {
  const [userDetails, setUserDetails] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [sandboxName, setSandboxName] = useState("");
  const [sandboxLocation, setSandboxLocation] = useState("southindia");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deletedSandbox, setDeletedSandbox] = useState(null);

  useEffect(() => {
    fetchSandboxDetails();
  }, [apiRoutes.sandboxApi]);

  const fetchSandboxDetails = async () => {
    try {
      const response = await apiCaller.get(apiRoutes.sandboxApi);
      setUserDetails(response.data);
    } catch (err) {
      console.error("Error fetching sandbox details:", err);
    }
  };

  if (!userDetails) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full mb-4"></div>
        <p className="text-gray-600 font-medium">Loading Sandbox Data...</p>
      </div>
    );
  }

  const availableCredits =
    userDetails.credits.total - userDetails.credits.consumed;
  const userIdPrefix = userDetails.userId.split("-")[0];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (sandboxName.length > 5 || sandboxName.length === 0) {
      setError("Sandbox name must be 1 to 5 characters long.");
      return;
    }

    const resourceGroupName = `${userIdPrefix}-${sandboxName}-sandbox`;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await apiCaller.post(apiRoutes.sandboxApi, {
        resourceGroupName,
        resourceGroupLocation: sandboxLocation,
      });

      setSuccess("Request sent. Please wait and refresh.");
      setShowForm(false);
      setSandboxName("");
      setSandboxLocation("southindia");
      fetchSandboxDetails();
    } catch (err) {
      setError("Error creating sandbox. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (resourceGroupName) => {
    setDeleting(true);
    setDeletedSandbox(resourceGroupName);
    setError(null);
    setSuccess(null);

    try {
      await apiCaller.delete(apiRoutes.sandboxApi, {
        data: { resourceGroupName },
      });
      setSuccess("Sandbox deleted. Please wait and refresh.");
      setUserDetails((prev) => ({
        ...prev,
        sandbox: prev.sandbox.filter(
          (s) => s.resourceGroupName !== resourceGroupName
        ),
      }));
    } catch (err) {
      setError("Error deleting sandbox. Please try again.");
    } finally {
      setDeleting(false);
      setDeletedSandbox(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto mt-10 p-6">
      {/* HEADER */}
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white p-8 rounded-3xl shadow-xl mb-10">
        <h1 className="text-3xl font-bold">Azure Sandbox Dashboard</h1>
        <p className="text-indigo-100 mt-1">
          Create, manage, and monitor your sandbox usage
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Card Item */}
          <div className="bg-white/20 backdrop-blur-sm p-4 rounded-xl shadow-sm hover:bg-white/25 transition">
            <p className="text-sm opacity-80">Email</p>
            <p className="font-semibold">{userDetails.email}</p>
          </div>

          <div className="bg-white/20 backdrop-blur-sm p-4 rounded-xl shadow-sm hover:bg-white/25 transition">
            <p className="text-sm opacity-80">Credits Used</p>
            <p className="font-semibold">
              {userDetails.credits.consumed} / {userDetails.credits.total}
            </p>
          </div>

          <div className="bg-white/20 backdrop-blur-sm p-4 rounded-xl shadow-sm hover:bg-white/25 transition">
            <p className="text-sm opacity-80">Available</p>
            <p className="font-semibold">{availableCredits}</p>
          </div>

          <a
            href="https://getlabs.cloud/azure-sandbox.pdf"
            target="_blank"
            rel="noreferrer"
            className="bg-white/20 backdrop-blur-sm p-4 rounded-xl shadow-sm hover:bg-white/30 transition text-center text-sm font-semibold"
          >
            Sandbox Guide →
          </a>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-100 text-red-700 shadow-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 rounded-lg bg-green-100 text-green-700 shadow-sm">
          {success}
        </div>
      )}

      {/* CREATE SANDBOX SECTION */}
      <div className="bg-white rounded-2xl shadow-xl p-6 mb-12 border border-gray-100">
        <button
          className={`w-full py-3 rounded-xl text-sm font-semibold transition shadow-sm ${
            availableCredits <= 0
              ? "bg-gray-200 text-gray-500 cursor-not-allowed"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
          onClick={() => setShowForm(!showForm)}
          disabled={availableCredits <= 0}
        >
          {showForm ? "Close" : "Create New Sandbox"}
        </button>

        {showForm && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1">
                Sandbox Name (1-5 letters)
              </label>
              <input
                type="text"
                value={sandboxName}
                onChange={(e) => setSandboxName(e.target.value)}
                maxLength={5}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              />
              {sandboxName && (
                <p className="text-xs text-gray-500 mt-1">
                  Resource Group:{" "}
                  <span className="font-semibold">
                    {`${userIdPrefix}-${sandboxName}-sandbox`}
                  </span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <select
                value={sandboxLocation}
                onChange={(e) => setSandboxLocation(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500"
              >
                <option value="southindia">South India</option>
                <option value="eastus">East US</option>
                <option value="westus">West US</option>
              </select>
            </div>

            <button
              type="submit"
              className={`w-full py-3 rounded-xl text-sm font-semibold transition ${
                loading
                  ? "bg-gray-300 cursor-wait"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Sandbox"}
            </button>
          </form>
        )}
      </div>

      {/* SANDBOX LIST */}
      <h2 className="text-xl font-semibold mb-4">Your Sandboxes</h2>

      {userDetails.sandbox.length === 0 ? (
        <p className="text-sm text-gray-500">
          No sandboxes created yet. Use the form above.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {userDetails.sandbox.map((sandbox) => {
            const isExpired = new Date(sandbox.deleteTime) < new Date();

            return (
              <div
                key={sandbox._id}
                className="p-5 bg-white rounded-2xl shadow-md border border-gray-100 hover:shadow-lg transition"
              >
                <h3 className="text-sm font-bold text-gray-900">
                  {sandbox.resourceGroupName}
                </h3>

                <div className="text-xs text-gray-600 mt-2 leading-relaxed">
                  <div>
                    <strong>Created:</strong>{" "}
                    {new Date(sandbox.createdTime).toLocaleString()}
                  </div>
                  <div>
                    <strong>Expires:</strong>{" "}
                    {new Date(sandbox.deleteTime).toLocaleString()}
                  </div>
                </div>

                <span
                  className={`inline-block px-3 py-1 mt-3 text-xs rounded-full font-medium ${
                    isExpired
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {isExpired ? "Expired" : "Active"}
                </span>

                <button
                  onClick={() => handleDelete(sandbox.resourceGroupName)}
                  className={`w-full mt-4 py-2.5 rounded-xl text-sm font-semibold transition ${
                    deleting && deletedSandbox === sandbox.resourceGroupName
                      ? "bg-red-300 cursor-wait"
                      : "bg-red-600 text-white hover:bg-red-700"
                  }`}
                  disabled={
                    deleting && deletedSandbox === sandbox.resourceGroupName
                  }
                >
                  {deleting && deletedSandbox === sandbox.resourceGroupName
                    ? "Deleting..."
                    : "Delete"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Azure;
