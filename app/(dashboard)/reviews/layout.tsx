import ClinicalAccessBoundary from "@/components/ClinicalAccessBoundary"
export default function ReviewsLayout({children}:{children:React.ReactNode}){
 return <ClinicalAccessBoundary>{children}</ClinicalAccessBoundary>
}
