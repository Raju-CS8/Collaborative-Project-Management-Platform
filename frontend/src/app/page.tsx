

"use client";



import { useCallback, useEffect, useState } from "react";

import { io } from "socket.io-client";



const API = "http://localhost:4000/api";



type User = {

  id: string;

  name: string;

  email: string;

  role: string;

};



type Project = {

  id: string;

  name: string;

  description: string;

  status: string;

  task_count: number;

  completed_tasks: number;

};



type Task = {

  id: string;

  project_id: string;

  title: string;

  description: string;

  status: "todo" | "in_progress" | "done";

  priority: "low" | "medium" | "high";

  version: number;

  assignee_id: string | null;

  assignee_name?: string;

};



export default function Home() {

  const [user, setUser] = useState<User | null>(null);

  const [token, setToken] = useState("");

  const [projects, setProjects] = useState<Project[]>([]);

  const [tasks, setTasks] = useState<Task[]>([]);

  const [selected, setSelected] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [notice, setNotice] = useState("");

  const [authMode, setAuthMode] = useState<"login" | "register">("login");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [name, setName] = useState("");

  const [projectName, setProjectName] = useState("");

  const [projectDescription, setProjectDescription] = useState("");

  const [taskTitle, setTaskTitle] = useState("");

  const [taskDescription, setTaskDescription] = useState("");

  const [taskPriority, setTaskPriority] = useState("medium");

  const [showProjectForm, setShowProjectForm] = useState(false);

  const [showTaskForm, setShowTaskForm] = useState(false);

  const [search, setSearch] = useState("");



  const request = useCallback(

    async (path: string, options: RequestInit = {}) => {

      const response = await fetch(`${API}${path}`, {

        ...options,

        headers: {

          "Content-Type": "application/json",

          ...(token ? { Authorization: `Bearer ${token}` } : {}),

          ...options.headers,

        },

      });



      const data = await response.json().catch(() => ({}));



      if (!response.ok) {

        throw new Error(data.error || `Request failed (${response.status})`);

      }



      return data;

    },

    [token]

  );







  const loadTasks = useCallback(async (projectId: string) => {

    if (!projectId) {

      setTasks([]);

      return;

    }



    const data = await request(`/projects/${projectId}/tasks`);

    setTasks(data.tasks);

  }, [request]);



  useEffect(() => {

    const savedToken = window.localStorage.getItem("neostats_token");

    if (!savedToken) return;



    let cancelled = false;



    async function restoreSession() {

      try {

        const response = await fetch(`${API}/me`, {

          headers: { Authorization: `Bearer ${savedToken}` },

        });

        if (!response.ok) throw new Error("Session expired");



        const data = await response.json();

        if (cancelled) return;



        setToken(savedToken!);

        setUser(data.user);

      } catch {

        window.localStorage.removeItem("neostats_token");

      }

    }



    void restoreSession();

    return () => {

      cancelled = true;

    };

  }, []);



  useEffect(() => {

    if (!token || !user) return;



    let cancelled = false;



    async function loadWorkspace() {

      setLoading(true);

      setError("");



      try {

        const data = await request("/projects");

        if (cancelled) return;



        setProjects(data.projects);



        setSelected((current) => {

          if (current && data.projects.some((p: Project) => p.id === current)) {

            return current;

          }

          return data.projects[0]?.id || "";

        });

      } catch (e) {

        if (!cancelled) {

          setError(e instanceof Error ? e.message : "Unable to load projects");

        }

      } finally {

        if (!cancelled) setLoading(false);

      }

    }



    void loadWorkspace();



    return () => {

      cancelled = true;

    };

  }, [token, user, request]);



  useEffect(() => {

    if (!token || !selected) {

  return;

}



    let cancelled = false;



    async function refreshTasks() {

      try {

        const data = await request(`/projects/${selected}/tasks`);

        if (!cancelled) setTasks(data.tasks);

      } catch (e) {

        if (!cancelled) {

          setError(e instanceof Error ? e.message : "Unable to load tasks");

        }

      }

    }



    void refreshTasks();

    return () => {

      cancelled = true;

    };

  }, [token, selected, request]);

  // Keep the selected project's task board synchronized across connected users.
  useEffect(() => {
    if (!token || !selected) return;

    const socket = io("http://localhost:4000", {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      socket.emit("project:join", selected);
    });

    socket.on("task:created", ({ task }: { task: Task }) => {
      if (task.project_id !== selected) return;

      setTasks((current) =>
        current.some((item) => item.id === task.id)
          ? current
          : [task, ...current]
      );
    });

    socket.on("task:updated", ({ task }: { task: Task }) => {
      if (task.project_id !== selected) return;

      setTasks((current) =>
        current.map((item) =>
          item.id === task.id && task.version >= item.version ? task : item
        )
      );
    });

    socket.on("comment:created", () => {
      setNotice("A new comment was added to this project.");
    });

    socket.on("connect_error", (socketError) => {
      console.error("NeoStats realtime connection:", socketError.message);
    });

    return () => {
      socket.disconnect();
    };
  }, [token, selected]);



  async function authenticate(event: React.FormEvent<HTMLFormElement>) {

    event.preventDefault();

    setLoading(true);

    setError("");

    setNotice("");



    try {

      const endpoint =

        authMode === "register" ? "/auth/register" : "/auth/login";



      const data = await request(endpoint, {

        method: "POST",

        body: JSON.stringify(

          authMode === "register"

            ? { name, email, password }

            : { email, password }

        ),

      });



      window.localStorage.setItem("neostats_token", data.token);

      setToken(data.token);

      setUser(data.user);

      setPassword("");

      setNotice(`Welcome, ${data.user.name}!`);

    } catch (e) {

      setError(e instanceof Error ? e.message : "Authentication failed");

    } finally {

      setLoading(false);

    }

  }



  async function createProject(event: React.FormEvent<HTMLFormElement>) {

    event.preventDefault();

    setError("");

    setNotice("");



    try {

      const data = await request("/projects", {

        method: "POST",

        body: JSON.stringify({

          name: projectName,

          description: projectDescription,

        }),

      });



      setProjects((current) => [data.project, ...current]);

      setSelected(data.project.id);

      setProjectName("");

      setProjectDescription("");

      setShowProjectForm(false);

      setNotice("Project created successfully.");

    } catch (e) {

      setError(e instanceof Error ? e.message : "Could not create project");

    }

  }



  async function createTask(event: React.FormEvent<HTMLFormElement>) {

    event.preventDefault();

    setError("");

    setNotice("");



    try {

      const data = await request(`/projects/${selected}/tasks`, {

        method: "POST",

        body: JSON.stringify({

          title: taskTitle,

          description: taskDescription,

          priority: taskPriority,

        }),

      });



      setTasks((current) => [data.task, ...current]);

      setTaskTitle("");

      setTaskDescription("");

      setTaskPriority("medium");

      setShowTaskForm(false);



      setProjects((current) =>

        current.map((p) =>

          p.id === selected

            ? { ...p, task_count: Number(p.task_count || 0) + 1 }

            : p

        )

      );



      setNotice("Task created successfully.");

    } catch (e) {

      setError(e instanceof Error ? e.message : "Could not create task");

    }

  }



  async function changeStatus(task: Task) {

    const nextStatus =

      task.status === "todo"

        ? "in_progress"

        : task.status === "in_progress"

          ? "done"

          : "todo";



    setError("");

    setNotice("");



    try {

      const data = await request(`/tasks/${task.id}/status`, {

        method: "PATCH",

        body: JSON.stringify({

          status: nextStatus,

          version: task.version,

        }),

      });



      setTasks((current) =>

        current.map((t) => (t.id === task.id ? data.task : t))

      );



      setProjects((current) =>

        current.map((p) => {

          if (p.id !== selected) return p;

          const wasDone = task.status === "done";

          const nowDone = data.task.status === "done";

          return {

            ...p,

            completed_tasks:

              Number(p.completed_tasks || 0) +

              (nowDone ? 1 : 0) -

              (wasDone ? 1 : 0),

          };

        })

      );



      setNotice("Task status updated.");

    } catch (e) {

      const message = e instanceof Error ? e.message : "Update failed";

      setError(message);



      if (message.toLowerCase().includes("changed since")) {

        void loadTasks(selected);

      }

    }

  }



  function logout() {

    window.localStorage.removeItem("neostats_token");

    setToken("");

    setUser(null);

    setProjects([]);

    setTasks([]);

    setSelected("");

    setError("");

    setNotice("");

  }



  const activeProject = projects.find((p) => p.id === selected);

  const filteredTasks = tasks.filter((task) =>

    `${task.title} ${task.description}`

      .toLowerCase()

      .includes(search.toLowerCase())

  );



  const completed = tasks.filter((task) => task.status === "done").length;

  const inProgress = tasks.filter(

    (task) => task.status === "in_progress"

  ).length;

  const todo = tasks.filter((task) => task.status === "todo").length;

  const progress =

    tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;



  const badgeStyle: Record<string, string> = {

    todo: "bg-slate-100 text-slate-600",

    in_progress: "bg-amber-100 text-amber-800",

    done: "bg-emerald-100 text-emerald-700",

    low: "bg-slate-100 text-slate-600",

    medium: "bg-blue-50 text-blue-700",

    high: "bg-rose-100 text-rose-700",

  };



  if (!user) {

    return (

      <main className="flex min-h-screen items-center justify-center bg-[#f5f6fa] px-4 py-10 text-slate-900">

        <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl md:grid-cols-2">

          <section className="flex flex-col justify-between bg-[#171b35] p-8 text-white sm:p-12">

            <div>

              <div className="flex items-center gap-3">

                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500 text-xl font-black">

                  N

                </div>

                <span className="text-xl font-bold tracking-tight">

                  NeoStats

                </span>

              </div>



              <div className="mt-16">

                <p className="text-xs font-bold uppercase tracking-[0.25em] text-violet-300">

                  Collaborative workspace

                </p>

                <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight">

                  Work together.

                  <br />

                  Move forward.

                </h1>

                <p className="mt-5 max-w-sm leading-7 text-slate-300">

                  A shared space to manage projects, track tasks, and keep

                  your team aligned.

                </p>

              </div>

            </div>



            <div className="mt-16 border-t border-white/10 pt-5 text-sm text-slate-400">

              Projects · Tasks · Team collaboration

            </div>

          </section>



          <section className="p-8 sm:p-12">

            <p className="text-sm font-semibold text-violet-600">

              YOUR WORKSPACE

            </p>

            <h2 className="mt-3 text-3xl font-bold tracking-tight">

              {authMode === "login" ? "Welcome back" : "Create your workspace"}

            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-500">

              {authMode === "login"

                ? "Sign in to continue to your projects."

                : "Register the first account to initialize your workspace as administrator."}

            </p>



            {error && (

              <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">

                {error}

              </div>

            )}



            <form onSubmit={authenticate} className="mt-7 space-y-4">

              {authMode === "register" && (

                <div>

                  <label className="mb-2 block text-sm font-semibold">

                    Full name

                  </label>

                  <input

                    required

                    value={name}

                    onChange={(e) => setName(e.target.value)}

                    className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"

                    placeholder="Your name"

                  />

                </div>

              )}



              <div>

                <label className="mb-2 block text-sm font-semibold">

                  Email address

                </label>

                <input

                  required

                  type="email"

                  value={email}

                  onChange={(e) => setEmail(e.target.value)}

                  className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"

                  placeholder="you@example.com"

                />

              </div>



              <div>

                <label className="mb-2 block text-sm font-semibold">

                  Password

                </label>

                <input

                  required

                  minLength={8}

                  type="password"

                  value={password}

                  onChange={(e) => setPassword(e.target.value)}

                  className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-100"

                  placeholder="At least 8 characters"

                />

              </div>



              <button

                disabled={loading}

                className="w-full rounded-xl bg-violet-600 px-4 py-3.5 font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"

              >

                {loading

                  ? "Please wait..."

                  : authMode === "login"

                    ? "Sign in →"

                    : "Create administrator account →"}

              </button>

            </form>



            <button

              onClick={() => {

                setAuthMode(authMode === "login" ? "register" : "login");

                setError("");

              }}

              className="mt-5 w-full text-center text-sm font-medium text-slate-500 hover:text-violet-700"

            >

              {authMode === "login"

                ? "First time here? Initialize workspace"

                : "Already have an account? Sign in"}

            </button>



            <p className="mt-8 text-center text-xs leading-5 text-slate-400">

              Secured API · Role-based access · PostgreSQL

            </p>

          </section>

        </div>

      </main>

    );

  }



  return (

    <main className="min-h-screen bg-[#f5f6fa] text-slate-900">

      <div className="flex min-h-screen">

        <aside className="hidden w-64 shrink-0 flex-col bg-[#171b35] text-white lg:flex">

          <div className="flex items-center gap-3 border-b border-white/10 px-6 py-6">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500 text-lg font-black">

              N

            </div>

            <div>

              <p className="text-lg font-bold">NeoStats</p>

              <p className="text-xs text-slate-400">Team workspace</p>

            </div>

          </div>



          <div className="px-4 py-6">

            <p className="px-3 text-xs font-bold uppercase tracking-widest text-slate-500">

              Workspace

            </p>

            <button className="mt-3 flex w-full items-center gap-3 rounded-xl bg-violet-500/20 px-3 py-3 text-left font-medium text-violet-200">

              <span>▦</span> Overview

            </button>

            <button

              onClick={() => setShowProjectForm(true)}

              className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-slate-300 transition hover:bg-white/5"

            >

              <span>＋</span> New project

            </button>

          </div>



          <div className="px-4">

            <p className="px-3 text-xs font-bold uppercase tracking-widest text-slate-500">

              Your projects

            </p>

            <div className="mt-3 space-y-1">

              {projects.map((project) => (

                <button

                  key={project.id}

                  onClick={() => setSelected(project.id)}

                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition ${

                    selected === project.id

                      ? "bg-white/10 text-white"

                      : "text-slate-400 hover:bg-white/5 hover:text-white"

                  }`}

                >

                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-400/20 text-xs font-bold text-violet-200">

                    {project.name.charAt(0).toUpperCase()}

                  </span>

                  <span className="truncate">{project.name}</span>

                </button>

              ))}

            </div>

          </div>



          <div className="mt-auto border-t border-white/10 p-5">

            <div className="flex items-center gap-3">

              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-400 font-bold text-white">

                {user.name.charAt(0).toUpperCase()}

              </div>

              <div className="min-w-0 flex-1">

                <p className="truncate text-sm font-semibold">{user.name}</p>

                <p className="text-xs capitalize text-slate-400">

                  {user.role.replaceAll("_", " ")}

                </p>

              </div>

            </div>

            <button

              onClick={logout}

              className="mt-4 w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:bg-white/5"

            >

              Sign out

            </button>

          </div>

        </aside>



        <section className="min-w-0 flex-1">

          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">

            <div>

              <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">

                Workspace / Overview

              </p>

              <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">

                Project command center

              </h1>

            </div>

            <div className="flex items-center gap-3">

              <div className="hidden text-right sm:block">

                <p className="text-sm font-semibold">{user.name}</p>

                <p className="text-xs capitalize text-slate-500">

                  {user.role.replaceAll("_", " ")}

                </p>

              </div>

              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 font-bold text-violet-700">

                {user.name.charAt(0).toUpperCase()}

              </div>

              <button

                onClick={logout}

                className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"

              >

                Sign out

              </button>

            </div>

          </header>



          <div className="mx-auto max-w-7xl space-y-7 p-5 sm:p-8">

            {error && (

              <div className="flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">

                <span>{error}</span>

                <button onClick={() => setError("")} aria-label="Dismiss error">

                  ✕

                </button>

              </div>

            )}



            {notice && (

              <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">

                <span>{notice}</span>

                <button onClick={() => setNotice("")} aria-label="Dismiss message">

                  ✕

                </button>

              </div>

            )}



            <section className="flex flex-wrap items-end justify-between gap-4">

              <div>

                <p className="text-sm text-slate-500">Your team at a glance</p>

                <h2 className="mt-1 text-2xl font-bold tracking-tight">

                  Good to see you, {user.name.split(" ")[0]}.

                </h2>

                <p className="mt-2 text-sm text-slate-500">

                  Keep the work moving. Every update counts.

                </p>

              </div>

              <button

                onClick={() => {

                  setError("");

                  setNotice("");

                  setShowProjectForm(!showProjectForm);

                }}

                className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"

              >

                + New project

              </button>

            </section>



            {showProjectForm && (

              <form

                onSubmit={createProject}

                className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2"

              >

                <div className="sm:col-span-2">

                  <h3 className="font-bold">Create a project</h3>

                  <p className="mt-1 text-sm text-slate-500">

                    Give your team a clear starting point.

                  </p>

                </div>

                <input

                  required

                  maxLength={150}

                  value={projectName}

                  onChange={(e) => setProjectName(e.target.value)}

                  placeholder="Project name"

                  className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500"

                />

                <input

                  value={projectDescription}

                  onChange={(e) => setProjectDescription(e.target.value)}

                  placeholder="Short description"

                  className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500"

                />

                <div className="flex gap-3 sm:col-span-2">

                  <button className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white">

                    Create project

                  </button>

                  <button

                    type="button"

                    onClick={() => setShowProjectForm(false)}

                    className="rounded-xl border border-slate-200 px-5 py-3 text-sm"

                  >

                    Cancel

                  </button>

                </div>

              </form>

            )}



            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

              {[

                {

                  label: "Projects",

                  value: projects.length,

                  sub: "Projects you can access",

                  icon: "▦",

                },

                {

                  label: "Total tasks",

                  value: tasks.length,

                  sub: "In the selected project",

                  icon: "☷",

                },

                {

                  label: "In progress",

                  value: inProgress,

                  sub: "Currently being worked on",

                  icon: "◷",

                },

                {

                  label: "Completed",

                  value: completed,

                  sub: "Finished tasks",

                  icon: "✓",

                },

              ].map((stat) => (

                <article

                  key={stat.label}

                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"

                >

                  <div className="flex items-center justify-between">

                    <p className="text-sm font-medium text-slate-500">

                      {stat.label}

                    </p>

                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-lg text-violet-700">

                      {stat.icon}

                    </span>

                  </div>

                  <p className="mt-4 text-3xl font-bold tracking-tight">

                    {stat.value}

                  </p>

                  <p className="mt-2 text-xs text-slate-500">{stat.sub}</p>

                </article>

              ))}

            </section>



            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">

              <div className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">

                  <div>

                    <h3 className="font-bold">Task board</h3>

                    <p className="mt-1 text-sm text-slate-500">

                      {activeProject?.name || "Choose a project to get started"}

                    </p>

                  </div>

                  <div className="flex flex-wrap gap-2">

                    <select

                      value={selected}

                      onChange={(e) => setSelected(e.target.value)}

                      className="max-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500"

                    >

                      <option value="">Select project</option>

                      {projects.map((p) => (

                        <option key={p.id} value={p.id}>

                          {p.name}

                        </option>

                      ))}

                    </select>

                    <button

                      disabled={!selected}

                      onClick={() => {

                        setError("");

                        setNotice("");

                        setShowTaskForm(!showTaskForm);

                      }}

                      className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"

                    >

                      + Task

                    </button>

                  </div>

                </div>



                {showTaskForm && selected && (

                  <form

                    onSubmit={createTask}

                    className="space-y-3 border-b border-slate-100 bg-slate-50 p-5"

                  >

                    <input

                      required

                      maxLength={200}

                      value={taskTitle}

                      onChange={(e) => setTaskTitle(e.target.value)}

                      placeholder="Task title"

                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-violet-500"

                    />

                    <textarea

                      value={taskDescription}

                      onChange={(e) => setTaskDescription(e.target.value)}

                      placeholder="Describe the task"

                      rows={2}

                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-violet-500"

                    />

                    <div className="flex flex-wrap items-center gap-3">

                      <select

                        value={taskPriority}

                        onChange={(e) => setTaskPriority(e.target.value)}

                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"

                      >

                        <option value="low">Low priority</option>

                        <option value="medium">Medium priority</option>

                        <option value="high">High priority</option>

                      </select>

                      <button className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white">

                        Save task

                      </button>

                      <button

                        type="button"

                        onClick={() => setShowTaskForm(false)}

                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm"

                      >

                        Cancel

                      </button>

                    </div>

                  </form>

                )}



                <div className="border-b border-slate-100 p-4">

                  <input

                    value={search}

                    onChange={(e) => setSearch(e.target.value)}

                    placeholder="Search tasks..."

                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-violet-500"

                  />

                </div>



                {!selected ? (

                  <div className="p-12 text-center">

                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-2xl text-violet-600">

                      ▦

                    </div>

                    <h4 className="mt-4 font-bold">Your workspace starts here</h4>

                    <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">

                      Create a project, then add tasks to organize the work.

                    </p>

                    <button

                      onClick={() => setShowProjectForm(true)}

                      className="mt-5 rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white"

                    >

                      Create your first project

                    </button>

                  </div>

                ) : filteredTasks.length === 0 ? (

                  <div className="p-10 text-center">

                    <p className="font-semibold">

                      {search ? "No matching tasks" : "No tasks yet"}

                    </p>

                    <p className="mt-2 text-sm text-slate-500">

                      {search

                        ? "Try a different search term."

                        : "Add the first task to give your project momentum."}

                    </p>

                  </div>

                ) : (

                  <div className="divide-y divide-slate-100">

                    {filteredTasks.map((task) => (

                      <article

                        key={task.id}

                        className="p-5 transition hover:bg-slate-50/80"

                      >

                        <div className="flex flex-wrap items-start justify-between gap-3">

                          <div className="min-w-0 flex-1">

                            <h4

                              className={`font-semibold ${

                                task.status === "done"

                                  ? "text-slate-400 line-through"

                                  : "text-slate-800"

                              }`}

                            >

                              {task.title}

                            </h4>

                            {task.description && (

                              <p className="mt-1 text-sm leading-6 text-slate-500">

                                {task.description}

                              </p>

                            )}

                            <div className="mt-3 flex flex-wrap items-center gap-2">

                              <span

                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeStyle[task.status]}`}

                              >

                                {task.status.replaceAll("_", " ")}

                              </span>

                              <span

                                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badgeStyle[task.priority]}`}

                              >

                                {task.priority} priority

                              </span>

                              <span className="text-xs text-slate-400">

                                Version {task.version}

                              </span>

                            </div>

                          </div>

                          <button

                            onClick={() => void changeStatus(task)}

                            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-violet-300 hover:text-violet-700"

                          >

                            Move to{" "}

                            {task.status === "todo"

                              ? "In progress"

                              : task.status === "in_progress"

                                ? "Done"

                                : "To do"}

                          </button>

                        </div>

                      </article>

                    ))}

                  </div>

                )}



                <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-slate-400">

                  <span>{filteredTasks.length} tasks shown</span>

                  <span>Updates saved to PostgreSQL</span>

                </div>

              </div>



              <aside className="space-y-6">

                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

                  <h3 className="font-bold">Project progress</h3>

                  <p className="mt-1 text-sm text-slate-500">

                    Completion for the selected project

                  </p>



                  <div className="mt-6 flex items-center justify-center">

                    <div

                      className="flex h-36 w-36 items-center justify-center rounded-full"

                      style={{

                        background: `conic-gradient(#7c3aed ${progress}%, #ede9fe ${progress}% 100%)`,

                      }}

                    >

                      <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white">

                        <span className="text-3xl font-bold">{progress}%</span>

                        <span className="mt-1 text-xs text-slate-500">

                          complete

                        </span>

                      </div>

                    </div>

                  </div>



                  <div className="mt-6 space-y-4">

                    {[

                      { label: "To do", value: todo, color: "bg-slate-400" },

                      {

                        label: "In progress",

                        value: inProgress,

                        color: "bg-amber-400",

                      },

                      {

                        label: "Completed",

                        value: completed,

                        color: "bg-emerald-500",

                      },

                    ].map((item) => (

                      <div key={item.label}>

                        <div className="mb-2 flex items-center justify-between text-sm">

                          <span className="flex items-center gap-2 text-slate-600">

                            <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />

                            {item.label}

                          </span>

                          <span className="font-semibold">{item.value}</span>

                        </div>

                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">

                          <div

                            className={`h-full rounded-full ${item.color}`}

                            style={{

                              width: `${

                                tasks.length

                                  ? (item.value / tasks.length) * 100

                                  : 0

                              }%`,

                            }}

                          />

                        </div>

                      </div>

                    ))}

                  </div>

                </article>



                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">

                  <div className="flex items-center gap-3">

                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-lg text-emerald-700">

                      ✓

                    </div>

                    <div>

                      <h3 className="font-bold">System status</h3>

                      <p className="text-xs text-slate-500">

                        Current session

                      </p>

                    </div>

                  </div>

                  <div className="mt-5 space-y-3">

                    {[

                      "Authenticated session",

                      "Express API",

                      "PostgreSQL database",

                    ].map((item) => (

                      <div

                        key={item}

                        className="flex items-center justify-between gap-3 text-sm"

                      >

                        <span className="text-slate-600">{item}</span>

                        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">

                          <span className="h-2 w-2 rounded-full bg-emerald-500" />

                          Active

                        </span>

                      </div>

                    ))}

                  </div>

                  <p className="mt-4 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-400">

                    Status reflects the current signed-in session. Use the

                    API health endpoint to verify database connectivity.

                  </p>

                </article>

              </aside>

            </section>



            <footer className="flex flex-wrap justify-between gap-2 py-2 text-xs text-slate-400">

              <span>NeoStats · Collaborative project management</span>

              <span>Role: {user.role.replaceAll("_", " ")}</span>

            </footer>

          </div>

        </section>

      </div>

    </main>

  );

}
