// app/room/[id]/page.tsx

export default function Room({ params }: { params: { id: string } }) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-[#1e1e1e] text-white font-mono">
            <div className="text-center">
                {/* This grabs the unique ID from the URL so you can verify it works */}
                <p className="text-gray-500 mb-2">Room ID: {params.id}</p>
                <h1 className="text-2xl animate-pulse">Editor goes here.</h1>
            </div>
        </div>
    );
}