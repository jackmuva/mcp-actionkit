import dotenv from "dotenv";
dotenv.config();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequest,
	CallToolRequestSchema,
	ListToolsRequestSchema,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";// Create server instance
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import jwt from "jsonwebtoken";

//helper functions
async function getActions(jwt: string): Promise<any | null> {
	try {
		const response = await fetch("https://actionkit.useparagon.com/projects/" + process.env.PARAGON_PROJECT_ID + "/actions?integrations=slack", {
			method: "GET",
			headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
		});
		if (!response.ok) {
			throw new Error(`HTTP error; status: ${response.status}`)
		}
		return (await response.json());
	} catch (error) {
		console.error("Could not make ActionKit POST request: " + error);
		return null;
	}
}

async function performAction(actionName: string, actionParams: any, jwt: string): Promise<any | null> {
	try {
		const response = await fetch("https://actionkit.useparagon.com/projects/" + process.env.PARAGON_PROJECT_ID + "/actions", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
			body: JSON.stringify({ action: actionName, parameters: actionParams })
		});
		if (!response.ok) {
			throw new Error(`HTTP error; status: ${response.status}`)
		}
		return (await response.json());
	} catch (error) {
		console.error("Could not make ActionKit POST request: " + error);
		return null;
	}
}


function signJwt(userId: string): string {
	if (process.env.SIGNING_KEY === undefined) {
		throw new Error("SIGNING_KEY env variable needs to be set")
	}

	const currentTime = Math.floor(Date.now() / 1000);

	return jwt.sign(
		{
			sub: userId,
			iat: currentTime,
			exp: currentTime + (60 * 60 * 24 * 7), // 1 week from now
		},
		process.env.SIGNING_KEY?.replaceAll("\\n", "\n"),
		{
			algorithm: "RS256",
		},
	);
}

function setupTools(): Array<Tool> {
	const usernamePrompt: Tool = {
		name: "PROMPT_FOR_EMAIL",
		description: `Use when a user first interacts with the chat or when a user is unable to authenticate. 
				Prompt for their email username.`,
		inputSchema: {
			type: "object",
			properties: {
				email: {
					type: "string",
					description: "email username"
				}
			},
			required: ["email"]
		}
	}
	const redirectToAuth: Tool = {
		name: "REDIRECT_TO_AUTHENTICATION_PAGE",
		description: `Use when a user has provided their email, but no tools have been made available.
				Provide the redirect link for user to authenticate and enable tools`,
		inputSchema: {
			type: "object",
			properties: {}
		}
	}
	const retrieveTools: Tool = {
		name: "RETRIEVE_TOOLS",
		description: `Use when a user has provided their email or when a user has confirmed that they have authenticated 
				via the REDIRECT_TO_AUTHENTICATION_PAGE tool. Attempt to retrieve tools`,
		inputSchema: {
			type: "object",
			properties: {
				confirmation: {
					type: "string",
					description: "whether the user has confirmed they have authenticated via the redirect"
				}
			},
			required: ["confirmation"]
		}
	}

	return [usernamePrompt, redirectToAuth, retrieveTools];
}

async function getTools(jwt: string): Promise<Array<any>> {
	const tools: Array<Tool> = [];
	const actionPayload = await getActions(jwt);
	const actions = actionPayload.actions;

	for (const integration of Object.keys(actions)) {
		for (const action of actions[integration]) {
			const tool: Tool = {
				name: action['function']['name'],
				description: action['function']['description'],
				inputSchema: action['function']['parameters']
			}
			tools.push(tool);
		}
	}
	return tools;
}


const PARAGON_USER = undefined;
const SETUP_TOOLS = ["PROMPT_FOR_EMAIL", "REDIRECT_TO_AUTHENTICATION_PAGE", "RETRIEVE_TOOLS"];
async function main() {
	let tools: Array<Tool> = [];
	if (PARAGON_USER) {
		const jwt = signJwt(PARAGON_USER);
		tools = await getTools(jwt);
		console.error("Tools received from ActionKit: ", tools);
	} else {
		tools = setupTools();
	}

	console.error("Starting MCP Server");
	const server = new Server(
		{
			name: "mcp-actionkit",
			version: "1.0.0",
		},
		{
			capabilities: {
				tools: {},
			},
		},
	);


	server.setRequestHandler(
		CallToolRequestSchema,
		async (request: CallToolRequest) => {
			console.error("Received CallToolRequest: ", request);
			try {
				if (!request.params.arguments) {
					throw new Error("No arguments provided");
				}
				if (!request.params.name) {
					throw new Error("Tool name is missing");
				}
				const args = request.params.arguments as unknown;
				const toolName = request.params.name;

				if (!PARAGON_USER || tools.length === 0) {
					const response = await performAction(toolName, args, jwt);
					return {
						content: [{ type: "text", text: JSON.stringify(response) }],
					};
				} else if ()
			} catch (error) {
				console.error("Error executing tool: ", error);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								error: error instanceof Error ? error.message : String(error),
							}),
						},
					],
				};
			}
		}
	);

	try {
		server.setRequestHandler(ListToolsRequestSchema, async () => {
			return { tools: tools };
		});

		const transport = new StdioServerTransport();
		await server.connect(transport);
		console.error("MCP Server running on stdio");

	} catch (error) {
		console.error("Error while initializing tools: ", error);
	}
}


main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});
