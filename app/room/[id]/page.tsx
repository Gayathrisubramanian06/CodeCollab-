import CollabEditor from '@/app/components/CollabEditor'

export default function RoomPage({ params }: { params: { id: string } }) {
    return (
        <main>
            <CollabEditor roomId={params.id} />
        </main>
    )
}