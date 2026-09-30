import { useNavigate } from "react-router-dom";

export default function login({ role }) {

  const navigate = useNavigate();

  const handleLogin = (e) => {
    e.preventDefault();

    if (role === "student") {
      navigate("/student/dashboard");
    } else if (role === "faculty") {
      navigate("/faculty/dashboard");
    }
  };

    return (
      
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
        <div className="text-center mb-8">
          <h1>
            {role === "student" ? "Student Login" : "Faculty Login"}
          </h1>
          <h1 className="text-3xl font-bold">
            CICT-Cert
          </h1>

          <p className="text-gray-500 mt-2">
            Certificate Issuance and Verification System
          </p>
        </div>

        <form className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2">
              Email
            </label>

            <input
              type="email"
              placeholder="Enter your email"
              className="w-full border rounded-md px-4 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Password
            </label>

            <input
              type="password"
              placeholder="Enter your password"
              className="w-full border rounded-md px-4 py-2"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-black text-white py-2 rounded-md"
            onClick={handleLogin}
          >
            Login
          </button>
        </form>
      </div>
    </div>
    );
}