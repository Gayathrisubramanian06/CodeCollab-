'use client';

import { createClient } from '@supabase/supabase-js';

// 1. Connect to the database using the keys from your .env.local file
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export default function Home() {

  // 2. The function that triggers when you click the button
  const handleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        // Send them to our test room after successful login
        redirectTo: `${window.location.origin}/room/test-123`,
      },
    });

    if (error) {
      console.error("Error logging in:", error.message);
      alert("Login failed! Check the console.");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0d1117] text-white p-6">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-extrabold tracking-tight mb-4 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
          CodeCollab
        </h1>

        <p className="text-lg text-gray-400 mb-8">
          Real-time AI pair programming. Zero setup, proactive AI code reviews, and seamless multiplayer collaboration in the browser.
        </p>

        {/* 3. We attached the handleLogin function to this button! */}
        <button
          onClick={handleLogin}
          className="flex items-center justify-center gap-3 px-6 py-3 mx-auto text-lg font-semibold bg-white text-black rounded-md hover:bg-gray-200 transition-colors"
        >
          <svg height="24" width="24" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Login with GitHub
        </button>
      </div>
    </main>
  );
}