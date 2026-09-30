import { useNavigate } from "react-router-dom"; 

const roles = [ 
    { 
        name: "Student", icon: "🎓", 
        description: "Access your certificates and embedded wallet.", 
        path: "/student/login", 
    }, 
    { 
        name: "Faculty", 
        icon: "👨‍🏫", 
        description: "Issue and manage certificates for CICT students.", 
        path: "/faculty/login", 
    }, 
    { 
        name: "Verifier", 
        icon: "🔍", 
        description: "Verify the authenticity of a CICT certificate.", 
        path: "/verify", 
    }, 
];

export default function RoleSelection() {
    const navigate = useNavigate();

    return(
        <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-4xl">

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-gray-900">
            CICT-Cert
          </h1>

          <p className="mt-2 text-gray-600">
            Certificate Issuance and Verification System
          </p>

          <h2 className="mt-8 text-2xl font-semibold text-gray-800">
            Select Your Role
          </h2>

          <p className="mt-2 text-gray-500">
            Choose how you want to access CICT-Cert.
          </p>
        </div>

        {/* Role Cards */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {roles.map((role) => (
            <button
              key={role.name}
              type="button"
              onClick={() => navigate(role.path)}
              className="
                rounded-xl
                border border-gray-200
                bg-white
                p-8
                text-left
                shadow-md
                transition
                duration-200
                hover:border-blue-500
                hover:shadow-lg
              "
            >
              <div className="mb-5 text-4xl">
                {role.icon}
              </div>

              <h3 className="text-xl font-semibold text-gray-900">
                {role.name}
              </h3>

              <p className="mt-2 text-gray-500">
                {role.description}
              </p>

              <div className="mt-6 font-medium text-blue-600">
                Continue →
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <p className="mt-10 text-center text-sm text-gray-400">
          CICT-Cert
        </p>

      </div>
    </div>
  );
}