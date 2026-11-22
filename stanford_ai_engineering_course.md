# NOTES

This video, the first lecture of the *Stanford CS329Z: Engineering AI Agents* course (Fall 2026), provides a foundational introduction to **agentic AI systems**. Professor *Diyi Yang* and her team explore the history, architecture, and current challenges of AI agents.

**Core highlights include:**

*   **A History of Agents (7:40-14:00):** Traces the concept from the 1973 *actor model* and early *multi-agent systems* to the modern era of **Large Language Models (LLMs)** and the emergence of tools like *ReAct*, *BabyAGI*, and *AutoGPT* (14:00).
*   **Anatomy of an LLM Agent (22:05):** Breaks down the structural framework of a modern AI agent into five key components: the **LLM core**, **planning and reasoning** modules (e.g., *Chain of Thought*, *Reflexion*), **memory** (episodic, semantic, and procedural), **tools** (like *Toolformer* and *Gorilla*), and the **environment**.
*   **Compound AI Systems (53:31):** Contrasts rigid **AI workflows** with more flexible **agentic systems** and introduces the *Model Context Protocol (MCP)* as a standard for tool integration (58:41).
*   **Key Challenges (1:01:05):** Discusses critical issues facing the field, including **reliability**, **safety**, **evaluation**, and the risks of **adversarial attacks** and **multi-agent collusion**.


This lecture, titled **Frameworks & Orchestration** (0:00) by Michael Ryan for Stanford's *CS329Z: Engineering AI Agents*, explores the landscape of frameworks for building compound AI systems and agents.

### Core Pillars of AI Systems

Ryan defines three pillars for engineering AI systems:

*   **Data**: Training data, demonstrations, and human feedback (3:02).
*   **System**: The model or agent (3:06).
*   **Evaluation & Metrics**: Defining success using metrics like pass rate, exact match, or an *LLM-as-a-judge* (3:21).

### Framework Landscape

The lecture categorizes frameworks based on their role in the development spectrum (4:25):

*   **Workflows/Programs**: Focus on orchestration and logic, such as **DSPy** and **LangGraph** (4:35).
*   **Reliability**: Frameworks that support durable execution like **Temporal** (4:39).
*   **Observability**: Tools like *Langfuse* and *MLflow* used for debugging and monitoring traces (4:41).

### Framework Deep Dives

*   **DSPy** (9:17): Focuses on *Signatures* (defining input/output contracts), *Modules* (logic composition), and *Optimizers* (improving prompt/weight performance using metrics) (9:34). Ryan demonstrates building a simple email-to-calendar agent and optimizing it for smaller models (26:31).
*   **LangGraph** (42:21): Utilizes a graph-based approach with a *shared state*, *nodes* (functions to read/write state), and *edges* (defining conditional control flow) (42:34).

### Agent Harnesses & Best Practices

*   **Harnesses**: The lecture reviews open-source agent environments like *mini-SWE-agent*, *OpenHands*, and *Pi Agent*, highlighting design choices in memory management and execution (58:08).
*   **Orchestration & Telemetry**: Emphasizes using tools to handle longer task durations and maintain system reliability (1:02:20).
*   **Best Practices**: Ryan advises keeping systems simple, designing for failure recovery, and relying on empirical evaluation to drive design decisions rather than intuition (1:08:05).

This lecture (0:01) from Stanford's *CS329Z* course provides a comprehensive guide to **AI agent design patterns**, covering the distinction between **workflows** and **agents**, and offering technical strategies for system architecture and context management.

### Workflows vs. Agents (3:34 - 6:46)

*   **Workflows:** Characterized by fixed control flow in code, best for repeatable, structured tasks like **support ticket classification**.
*   **Agents:** Rely on the **LLM** (Large Language Model) to determine tool calls and actions, making them highly flexible for exploratory tasks.

### Workflow Design Patterns (6:46 - 33:17)

Michael Ryan outlines *Anthropic’s* taxonomy for effective agent workflows:

*   **Prompt Chaining:** Decomposing a large task into a sequence of smaller calls.
*   **Routing:** Directing input to specialized LLMs based on task category.
*   **Parallelization:** Dividing work among multiple threads for efficiency.
*   **Orchestrator-Workers:** An LLM identifies subtasks and assigns them to specialized workers.
*   **Evaluator-Optimizer:** An iterative loop where an LLM generates output and another reviews or improves it.

### Agent Design Patterns (33:17 - 55:40)

*   **Reasoning and Acting (ReAct):** Combines chain-of-thought reasoning with environment interactions to solve problems step-by-step (34:34).
*   **Reflection:** Agents learn from long-term experience by evaluating past trajectories (37:42).
*   **CodeAct:** Uses code as the primary form for agent actions, allowing for structured data manipulation (45:34).
*   **Planning then Executing:** Methods like *ReWOO* and *LLMCompiler* generate a complete execution plan before running tools, optimizing token usage (49:16).

### Context Management (55:40 - 1:12:07)

Critical techniques to maintain performance without exceeding context limits include:

*   **Persistent Event Logs:** Maintaining a full history of all interactions (59:09).
*   **Compaction:** Summarizing or condensing history to reduce bloat (103:23).
*   **Observation Masking:** Programmatically truncating or deleting past tool outputs (105:35).
*   **Context Isolation:** Using **subagents** or **skill files** (progressive disclosure) to keep memory focused (107:36).

### Case Study: Pi (1:12:07 - 1:16:51)

The lecture concludes with an analysis of *Pi*, a minimalist agent harness that implements many of these patterns, such as React-style reasoning and skill-based progressive disclosure, while running without built-in safety safeguards.

This lecture provides an in-depth exploration of **multi-agent systems (MAS)**, examining when they are beneficial compared to single-agent systems, how to design them, and why they sometimes fail. Michael Ryan defines an MAS as a collection of agents oriented toward a shared task (5:02).

**Key Takeaways:**

*   **Orchestration Patterns:** The lecture outlines four primary ways to organize agents: **Independent** (agents work alone, results aggregated), **Centralized Orchestrator** (one agent delegates to workers), **Decentralized Swarm** (all agents communicate freely), and **Hybrid** (an orchestrator manages workers who can also communicate directly) (17:12).
*   **Communication Channels:** Agents interact using diverse methods such as standard **conversations** (e.g., AutoGen), **handoffs** (transferring control), **message boards** (e.g., MetaGPT), and the formal **Agent-to-Agent (A2A) protocol** (31:06).
*   **Coordination Infrastructure:** To manage collective work, systems often employ **task ledgers** (to-do lists), **shared memory** architectures, and workspace isolation (56:22).
*   **Failure Modes:** Multi-agent systems often suffer from high **coordination overhead**, increased costs (14:27), and behavioral issues like a lack of diversity in thought or hostile conflict resolution (e.g., agents revoking each other's permissions or “kicking” peers off a system) (1:15:30).

**Recommendation:** While MAS can handle complex, multi-faceted projects, the lecturer suggests starting with a single agent. Multi-agent systems are often more expensive and complex, so they should only be used when tasks can be clearly divided and parallelized to provide a meaningful performance gain (12:00-15:00).