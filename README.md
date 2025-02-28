# AI Data Modeler

<p align="center">
  <img src="public/logo.png" alt="AI Data Modeler Logo" width="200"/>
</p>

<p align="center">
  <strong>Leverage AI to build and refine your data models with ease</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#environment-variables">Environment Variables</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

## Overview

AI Data Modeler is an open-source tool designed to help software engineers create, visualize, and refine data models for their applications using AI assistance. Whether you're starting a new project or extending an existing one, AI Data Modeler streamlines the process of designing your database schema.

### Why AI Data Modeler?

Data modeling is a critical but often time-consuming part of software development. Traditional approaches require extensive manual work and deep expertise in database design. AI Data Modeler addresses these challenges by:

1. **Reducing time-to-model**: Generate comprehensive data models in minutes instead of hours or days
2. **Leveraging best practices**: AI suggestions incorporate industry standards and patterns
3. **Improving model quality**: Interactive refinement helps catch issues early
4. **Visualizing relationships**: See your data model come to life with ER diagrams
5. **Providing flexibility**: Work with AI or manually edit your schema as needed

## Target Users

AI Data Modeler is built for:

- **Software Engineers** who want to quickly create data models for new projects
- **Database Designers** looking to validate and improve their schemas
- **Technical Architects** who need to communicate data structures to stakeholders
- **Full-Stack Developers** building applications that require efficient data storage
- **Startups** that need to rapidly prototype and iterate on their data models

## Features

### Guided Initial Setup

- Interactive chat interface that guides you through defining your project requirements
- Structured collection of project details, functional requirements, and non-functional requirements
- The more detail you provide, the better your initial data model will be

### AI-Powered Data Modeling

- Generate comprehensive data models based on your requirements
- Get intelligent suggestions for entities, relationships, fields, and constraints
- Receive explanations for design decisions and best practices

### Interactive Refinement

- Chat with an AI assistant about your data model
- Ask questions about design choices, performance implications, and best practices
- Receive suggestions for improvements as you discuss your model
- Review, edit, delete, or add your own suggestions
- Apply changes with a single click

### Visual and Code Representations

- View your data model as an Entity-Relationship diagram
- Edit the schema directly in a code editor with syntax highlighting
- See changes reflected in real-time between visual and code views

### Requirements Management

- View and edit the requirements collected during the initial conversation
- Update your project details at any time to refine your model

## Demo

[Link to demo video or live demo - Coming soon]

## Installation

AI Data Modeler is built with [Wasp](https://wasp-lang.dev/), a full-stack framework for React and Node.js.

### Prerequisites

- Node.js (v14 or later)
- npm or yarn
- PostgreSQL database

### Setup

1. Clone the repository:

```bash
git clone https://github.com/yourusername/ai-data-modeler.git
cd ai-data-modeler
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

Create a `.env.server` file in the root directory with the following variables:

```
OPENAI_API_KEY=your_openai_api_key
```

4. Start the development server:

```bash
wasp start
```

### Deployment

AI Data Modeler can be deployed using [Fly.io](https://fly.io/):

1. Install the Fly CLI:

```bash
curl -L https://fly.io/install.sh | sh
```

2. Log in to Fly:

```bash
fly auth login
```

3. Deploy the application:

```bash
wasp deploy fly launch
```

4. Set environment variables:

```bash
fly secrets set OPENAI_API_KEY=your_openai_api_key
```

## Usage

### Creating a New Data Model

1. Sign up or log in to your account
2. Click "Create New Data Model" on the dashboard
3. Enter a name and brief description for your project
4. Follow the guided conversation to provide details about your project
5. Review the generated data model

### Refining Your Data Model

1. Chat with the AI assistant about your data model
2. Ask questions about design choices or potential improvements
3. Review the suggestions that appear during your conversation
4. Edit, delete, or add your own suggestions
5. Click "Apply Changes" to update your data model

### Manual Editing

1. Use the code editor to directly modify your schema
2. Save your changes to update the data model
3. View the updated ER diagram to visualize your changes

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | Your OpenAI API key for AI functionality | Yes |
| `DATABASE_URL` | PostgreSQL connection string (set automatically by Wasp) | Yes |

## Architecture

AI Data Modeler is built with:

- **Frontend**: React, TailwindCSS, Monaco Editor, ReactFlow
- **Backend**: Node.js, Express
- **Database**: PostgreSQL
- **AI**: OpenAI GPT models
- **Framework**: Wasp (full-stack React/Node.js framework)

### Data Model

The application uses the following core entities:

- **User**: Authentication and user management
- **DataModel**: The main container for a data model project
- **ModelEntity**: Represents tables (SQL), collections (NoSQL), or nodes (Graph)
- **Field**: Properties of entities with types and constraints
- **Relation**: Connections between entities (foreign keys, references, edges)
- **ChatMessage**: Stores conversation history with the AI assistant

## Future Features

- **Version Control**: Track changes and roll back to previous versions
- **Export Options**: Generate SQL, Prisma schema, Mongoose models, etc.
- **Collaboration**: Share and collaborate on data models with team members
- **Templates**: Start from industry-specific templates
- **Performance Analysis**: Get insights on potential performance issues

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgements

- [Wasp](https://wasp-lang.dev/) - The full-stack framework used
- [OpenAI](https://openai.com/) - For the AI models powering the assistant
- [ReactFlow](https://reactflow.dev/) - For the ER diagram visualization
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - For the code editor 