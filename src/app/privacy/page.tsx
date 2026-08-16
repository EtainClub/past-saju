import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

// 문안은 코드 동작을 근거로 작성했습니다.
// TODO: 사업자 등록 후 상호·대표자·주소를 추가할 것.
const CONTACT = "etainclub@gmail.com";
const EFFECTIVE_DATE = "2026년 8월 16일";

export const metadata: Metadata = {
  title: "개인정보처리방침 — 만약사주",
  description: "만약사주가 수집하는 정보, 보유 기간, 처리위탁 현황과 이용자의 권리를 안내합니다.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/">← 만약사주로 돌아가기</Link>

      <h1>개인정보처리방침</h1>
      <p className={styles.updated}>시행일 {EFFECTIVE_DATE}</p>

      <p>
        만약사주(이하 &ldquo;서비스&rdquo;)는 사주 규칙을 적용해 지나간 선택을 다른 각도에서 돌아보는 반사실 서사를
        제공합니다. 서비스는 이용자를 식별하는 정보를 수집하지 않으며, 입력한 내용은 짧은 기간만 보관한 뒤 자동으로
        삭제됩니다.
      </p>

      <h2>1. 수집하는 정보</h2>
      <p>회원가입이 없으므로 계정 정보를 수집하지 않습니다. 해석에 필요한 아래 항목만 이용자가 직접 입력합니다.</p>
      <table>
        <thead>
          <tr><th>구분</th><th>항목</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>출생 정보</td>
            <td>생년월일, 양력·음력 구분과 윤달 여부, 태어난 시각(모를 경우 미입력), 태어난 지역, 성별(응답하지 않을 수 있음)</td>
          </tr>
          <tr>
            <td>사건 정보</td>
            <td>갈림길의 분류와 시점(연·월), 그때의 이야기, 실제 결과와 가지 않은 선택에 대한 서술(뒤 두 항목은 선택)</td>
          </tr>
          <tr>
            <td>맥락 정보</td>
            <td>당시의 준비도·선택 여지·두려움 정도(각 5단계)</td>
          </tr>
          <tr>
            <td>자동 생성</td>
            <td>세션 식별자, 생성·완료 시각, 결과에 대한 만족도 응답(선택)</td>
          </tr>
        </tbody>
      </table>

      <p>
        <strong>수집하지 않는 정보:</strong> 이름, 연락처, 이메일, 정확한 주소, 결제 정보를 수집하지 않습니다.
        쿠키를 이용한 광고·행태 정보 수집도 하지 않습니다.
      </p>

      <h2>2. 이용 목적</h2>
      <ul>
        <li>출생 정보와 사건 정보: 사주 명식 산출과 반사실 서사 생성</li>
        <li>세션 식별자와 시각: 카드 선택 잠금, 중복 응답 방지, 결과 재열람</li>
        <li>만족도 응답: 서사 품질 개선(개별 이용자와 연결하지 않고 집계로만 사용)</li>
      </ul>

      <h2>3. 보유 기간과 파기</h2>
      <ul>
        <li>
          서버에 저장된 세션과 만족도 응답은 <strong>생성 후 7일이 지나면 이용이 차단되고, 저장소의 자동 삭제
          정책(TTL)에 따라 파기</strong>됩니다.
        </li>
        <li>출생 정보는 다시 입력하는 번거로움을 줄이기 위해 이용자 브라우저에도 저장되며, 브라우저 저장소를 비우면 즉시 사라집니다.</li>
        <li>
          과도한 자동 요청을 막기 위해 접속 IP 주소를 <strong>되돌릴 수 없는 형태로 변환(해시)</strong>해 요청 횟수만
          세며, 이 기록은 최대 1시간 뒤 자동 삭제됩니다. 원본 IP 주소는 저장하지 않습니다.
        </li>
      </ul>

      <h2>4. 처리위탁</h2>
      <p>서비스 운영을 위해 아래와 같이 개인정보 처리를 위탁하고 있습니다.</p>
      <table>
        <thead>
          <tr><th>수탁자</th><th>위탁 업무</th><th>처리 위치</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Google LLC<br />(Firebase / Google Cloud)</td>
            <td>애플리케이션 호스팅, 데이터베이스 저장 및 자동 삭제</td>
            <td>대만(asia-east1)</td>
          </tr>
          <tr>
            <td>Anthropic PBC</td>
            <td>
              적어 주신 갈림길 서술을 정해진 분류 체계로 해석(분류 판정과 원문 발췌).
              생년월일시와 명식 계산 결과는 전송하지 않습니다.
            </td>
            <td>미국</td>
          </tr>
        </tbody>
      </table>
      <p className={styles.note}>
        갈림길 분류에 외부 인공지능 서비스를 쓰는 경우는 <strong>서비스가 자체 규칙으로 갈림길을 판단하지 못했을 때로
        한정</strong>되며, 자동 해석을 하지 않는 주제(죽음·폭력·심각한 사고)로 분류된 서술은 전송되지 않습니다.
        전송된 내용은 모델 학습에 사용되지 않습니다. 위탁 내용이 변경되면 이 방침을 갱신해 사전에 알립니다.
      </p>

      <h2>5. 이용자의 권리</h2>
      <p>
        서비스는 이용자를 식별할 수 있는 정보를 보관하지 않으므로, 특정 개인의 기록을 찾아 열람하거나 정정하는 것은
        기술적으로 불가능합니다. 대신 다음 방법으로 입력한 내용을 없앨 수 있습니다.
      </p>
      <ul>
        <li>결과 화면을 닫고 7일을 기다리면 서버 기록은 자동으로 파기됩니다.</li>
        <li>브라우저 저장소를 비우면 이 기기에 남은 출생 정보 캐시가 즉시 삭제됩니다.</li>
        <li>
          결과 링크(세션 식별자)를 알고 있다면 <a className={styles.contact} href={`mailto:${CONTACT}`}>{CONTACT}</a>로
          삭제를 요청할 수 있습니다.
        </li>
      </ul>

      <h2>6. 만 14세 미만 아동</h2>
      <p>
        서비스는 만 14세 미만에게 제공하지 않습니다. 이용 시작 시 연령을 확인하며, 만 14세 미만임을 선택하면 서비스를
        이용할 수 없습니다.
      </p>

      <h2>7. 안전성 확보 조치</h2>
      <ul>
        <li>데이터베이스는 서버에서만 접근할 수 있으며 브라우저의 직접 접근을 전면 차단합니다.</li>
        <li>모든 통신은 HTTPS로 암호화됩니다.</li>
        <li>보관 기간이 지난 기록은 저장소의 자동 삭제 정책으로 파기합니다.</li>
      </ul>

      <h2>8. 문의</h2>
      <p>
        개인정보 처리에 관한 문의는 <a className={styles.contact} href={`mailto:${CONTACT}`}>{CONTACT}</a>로 보내주세요.
      </p>

      <h2>9. 방침 변경</h2>
      <p>이 방침이 변경되면 시행일을 갱신해 이 페이지에 게시합니다.</p>
    </main>
  );
}
