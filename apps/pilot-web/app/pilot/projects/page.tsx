import { NextRequest } from "next/server";
import projectRegistry from "../../../lib/pilot/project-registry";

export default function ProjectRegistryPage() {
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Pilot Project Registry</h1>
      
      {projectRegistry.projects.map((project) => (
        <div key={project.key} className="border p-4 mb-4 rounded">
          <h2 className="text-xl font-semibold">{project.name}</h2>
          <p className="text-gray-600">{project.description}</p>
          
          <div className="mt-2">
            <h3 className="font-medium">Services</h3>
            <ul className="list-disc pl-5">
              {project.services?.map((service, index) => (
                <li key={index}>{service.name} - {service.protocol.toUpperCase()}:{service.port} - {service.description}</li>
              ))}
            </ul>
          </div>
          
          <div className="mt-2">
            <h3 className="font-medium">Hazards</h3>
            <ul className="list-disc pl-5">
              {project.hazards?.map((hazard, index) => (
                <li key={index}>{hazard.description}</li>
              ))}
            </ul>
          </div>
          
          <div className="mt-2">
            <h3 className="font-medium">Safe Commands</h3>
            <ul className="list-disc pl-5">
              {project.safeCommands?.map((command, index) => (
                <li key={index}>{command}</li>
              ))}
            </ul>
          </div>
          
          <div className="mt-2">
            <h3 className="font-medium">Forbidden Commands</h3>
            <ul className="list-disc pl-5">
              {project.forbiddenCommands?.map((command, index) => (
                <li key={index}>{command}</li>
              ))}
            </ul>
          </div>
          
          <div className="mt-2">
            <h3 className="font-medium">Verification Gates</h3>
            <ul className="list-disc pl-5">
              {project.verificationGates?.map((gate, index) => (
                <li key={index}>{gate.name} - {gate.description}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
