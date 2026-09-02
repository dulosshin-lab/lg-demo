// design/260831_0656_면접AX_UI개편시안.html 의 정적 시안 화면을 그대로 옮겨 온 목업 마크업이다.
// 라이트 데모에서 동작하는 화면은 지원자 명단 등록(roster)과 면접 일정 편성(schedule) 둘뿐이고,
// 나머지 메뉴는 이 마크업을 그대로 보여 주는 시연용 화면이다.
export const DEMO_PAGES: Record<string, string> = {
  'dash': `
      <h1>운영 대시보드</h1>
      <p class="caption">전형의 지금 상태와 다음 할 일을 확인합니다.</p>

      <div class="cards">
        <div class="stat"><div class="k">전체 지원자</div><div class="v">467</div></div>
        <div class="stat"><div class="k">면접 대상</div><div class="v">60</div></div>
        <div class="stat"><div class="k">팀 지목</div><div class="v">109<small>건</small></div></div>
        <div class="stat"><div class="k">편성</div><div class="v">60<small>명, 3일</small></div></div>
      </div>

      <div class="panel">
        <div class="head"><h2>진행 단계</h2><button class="btn sm pri" data-goto="change">다음 할 일: 변경 대응 3건 →</button></div>
        <div class="pipe">
          <div class="stage"><div class="n">완료</div><div class="t">전형 설정</div><div class="f">3일, 8세션</div></div>
          <div class="stage"><div class="n">완료</div><div class="t">지원자 명단</div><div class="f">60명</div></div>
          <div class="stage"><div class="n">완료</div><div class="t">희망자 취합</div><div class="f">8/8팀</div></div>
          <div class="stage"><div class="n">완료</div><div class="t">데이터 검증</div><div class="f">결측 0</div></div>
          <div class="stage"><div class="n">완료</div><div class="t">일정 편성</div><div class="f">위반 0</div></div>
          <div class="stage next"><div class="n">진행 중</div><div class="t">변경 대응</div><div class="f">3건 대기</div></div>
        </div>
      </div>

      <div class="cards" style="grid-template-columns:1fr 1fr">
        <div class="panel" style="margin:0">
          <div class="head"><h2>병목</h2></div>
          <span class="chip"><span class="dot"></span>막힌 곳이 없습니다</span>
        </div>
        <div class="panel" style="margin:0">
          <div class="head"><h2>실측 지표</h2></div>
          <div class="row" style="gap:8px">
            <span class="chip">편성 소요 <b>1.4초</b></span>
            <span class="chip">하드 위반 <b>0건</b></span>
            <span class="chip">재편성 변경 <b>0명</b></span>
          </div>
        </div>
      </div>
`,

  'setup': `
      <h1>전형 설정</h1>
      <p class="caption">면접 기간, 일일 슬롯, 회신 마감일, 편성 규칙을 정합니다.</p>

      <div class="step"><div class="sn">A</div><div class="body">
        <h2>면접 기간</h2><p class="cap">시작일과 최소 일수를 정하고 주말을 제외합니다.</p>
        <div class="row">
          <div class="field"><label>시작일</label><input value="2026-08-17"></div>
          <div class="field"><label>최소 일수</label><input value="자동 (3일)" style="width:90px"></div>
          <span class="switch"><span class="sw on"></span>주말 건너뛰기</span>
        </div>
      </div></div>

      <div class="step"><div class="sn">B</div><div class="body">
        <h2>일일 슬롯</h2><p class="cap">8세션 × 4조, 면접 25분, 휴식 5분으로 진행합니다.</p>
        <div class="row">
          <button class="btn sm">8×4</button><button class="btn sm">10×6</button><button class="btn sm">14×6</button>
          <span class="chip">하루 <b>32</b>자리</span>
        </div>
      </div></div>

      <div class="step"><div class="sn">C</div><div class="body">
        <h2>팀 회신 마감일</h2><p class="cap">마감이 지나면 조직 희망자 취합에서 확정합니다.</p>
        <div class="row"><div class="field"><input value="2026-08-12"></div><span class="chip"><span class="dot"></span>용량 검산: 가능, 3일, 60/96</span></div>
      </div></div>

      <div class="step"><div class="sn">D</div><div class="body">
        <h2>편성 규칙</h2><p class="cap">학력 분리, 면접관 중복, 첫 타임 회피, 솔버 시간을 정합니다.</p>
        <div class="row">
          <span class="switch"><span class="sw on"></span>학력 분리</span>
          <span class="switch"><span class="sw on"></span>면접관 중복 검사</span>
          <div class="field"><label>첫 타임 회피</label><select><option>소프트</option></select></div>
          <button class="btn sm">빠른 편성 (판당 10초)</button>
        </div>
      </div></div>

      <details class="fold"><summary>Webex 링크<span class="badge">0/4조 입력됨</span></summary>
        <div class="fold-body">조별 상설 링크는 브라우저에 저장됩니다.</div>
      </details>
`,

  'req': `
      <h1>조직 희망자 취합</h1>
      <p class="caption">각 팀의 희망자 선택과 면접위원 가용시간 회신을 확인합니다.</p>

      <div class="cards">
        <div class="stat"><div class="k">희망 지원자</div><div class="v">60</div></div>
        <div class="stat"><div class="k">면접 신청</div><div class="v">109<small>건</small></div></div>
        <div class="stat"><div class="k">복수 팀 지원자</div><div class="v">9</div></div>
        <div class="stat"><div class="k">선택 완료 팀</div><div class="v">8<small>/ 8</small></div></div>
      </div>

      <div class="panel">
        <div class="head"><h2>팀별 신청 현황</h2><span class="sub">회신 마감 8/12, 실시간 반영</span></div>
        <div class="tblwrap"><table>
          <thead><tr><th>팀</th><th>신청</th><th>가용시간</th><th>상태</th><th></th></tr></thead>
          <tbody>
            <tr><td>로봇응용기술팀</td><td>18건</td><td>4/4명</td><td><span class="chip"><span class="dot"></span>완료 14:02</span></td><td></td></tr>
            <tr><td>AI솔루션팀</td><td>16건</td><td>3/3명</td><td><span class="chip"><span class="dot"></span>완료 11:40</span></td><td></td></tr>
            <tr><td>배터리기술팀</td><td>15건</td><td>3/3명</td><td><span class="chip"><span class="dot"></span>완료 09:15</span></td><td></td></tr>
            <tr><td>전극기술팀</td><td>14건</td><td>2/3명</td><td><span class="chip"><span class="dot half"></span>선택 중 (D-2)</span></td><td><button class="btn sm">리마인더</button></td></tr>
          </tbody>
        </table></div>
        <p class="more">외 4팀이 완료했습니다.</p>
      </div>

      <div class="panel">
        <div class="upload">
          <div><h2>희망자 취합 마감</h2><p style="font-size:12.5px; color:var(--muted); margin:4px 0 0">마감하면 팀 화면이 잠기고 취합 데이터 검증이 열립니다.</p></div>
          <button class="btn pri">취합 마감</button>
        </div>
      </div>
`,

  'verify': `
      <h1>취합 데이터 검증</h1>
      <p class="caption">편성 전에 조인, 결측, 중복을 확인합니다.</p>

      <div class="panel">
        <div class="row" style="gap:10px">
          <span class="chip"><span class="dot"></span>조인키 매칭 <b>60/60</b></span>
          <span class="chip"><span class="dot"></span>핵심 컬럼 결측 <b>0건</b></span>
          <span class="chip"><span class="dot"></span>지원자번호 중복 <b>0건</b></span>
        </div>
      </div>

      <div class="panel">
        <div class="head"><h2>복수 팀 중복 지목</h2><span class="sub">합동 세션 1회로 처리합니다</span></div>
        <div class="tblwrap"><table>
          <thead><tr><th>지원자</th><th>학력</th><th>지목 팀</th><th>처리</th></tr></thead>
          <tbody>
            <tr><td>지원자 041</td><td>석사</td><td>로봇응용기술팀, 전극기술팀</td><td>합동 세션 1회, 첫 타임 회피</td></tr>
            <tr><td>지원자 112</td><td>박사</td><td>AI솔루션팀, 미래혁신팀</td><td>합동 세션 1회, 첫 타임 회피</td></tr>
          </tbody>
        </table></div>
        <p class="more">외 7건이 있습니다.</p>
      </div>

      <div class="panel">
        <div class="upload">
          <div><h2>다음 단계</h2><p style="font-size:12.5px; color:var(--muted); margin:4px 0 0">결측이 0건이므로 편성으로 넘어갈 수 있습니다.</p></div>
          <button class="btn pri" data-goto="sched">면접 일정 편성 열기</button>
        </div>
      </div>
`,

  'change': `
      <h1>변경 대응과 재통보</h1>
      <p class="caption">통보한 뒤 생기는 취소, 추가, 면접관 교체를 처리합니다. 확정한 사람은 재편성해도 움직이지 않습니다.</p>

      <div class="panel">
        <div class="row" style="gap:8px">
          <span class="chip strong">통보 확정 <b>2일, 40명</b></span>
          <span class="chip"><span class="dot half"></span>처리 대기 <b>3건</b></span>
          <span class="chip">이동 로그 <b>0건</b></span>
        </div>
      </div>

      <div class="actioncards">
        <div class="action"><h2>지원자 취소</h2><p>대기 1건 (지원자 190)</p><button class="btn sm">처리</button></div>
        <div class="action"><h2>지원자 추가</h2><p>대기 1건 (신규 1명)</p><button class="btn sm">처리</button></div>
        <div class="action"><h2>면접관 일정 불가</h2><p>대기 1건 (전극기술팀 1명)</p><button class="btn sm">처리</button></div>
        <div class="action"><h2>수동 재배치</h2><p>격자에서 옮긴 배치 0건, 저장본 2벌</p><button class="btn sm" data-goto="sched">격자 열기</button></div>
      </div>

      <div class="panel">
        <div class="head"><h2>재통보 명단</h2><span class="sub">변경 반영 후 자동 산출됩니다</span></div>
        <div class="upload">
          <span class="chip">60명 중 <b>재통보 4명</b>, 56명 그대로</span>
          <div class="row">
            <button class="btn sm">지원자 명단 CSV</button>
            <button class="btn sm">면접관 명단 CSV</button>
            <button class="btn sm pri">확정 통보 메일 열기</button>
          </div>
        </div>
      </div>
`,

  'close': `
      <h1>전형 종료와 산출물</h1>
      <p class="caption">최신 편성을 확정본으로 고정하고 전형를 읽기 전용으로 닫습니다.</p>

      <div class="cards">
        <div class="stat"><div class="k">전형 상태</div><div class="v" style="font-size:16px">진행중</div></div>
        <div class="stat"><div class="k">잠금 범위</div><div class="v" style="font-size:16px">명단, 지목, 배정, 평가</div></div>
        <div class="stat"><div class="k">최신 실행</div><div class="v" style="font-size:16px">run 9814efa</div></div>
      </div>

      <div class="panel">
        <div class="head"><h2>산출물 내려받기</h2></div>
        <div class="row">
          <button class="btn">시간표 XLSX</button><button class="btn">안내 명단 XLSX</button>
          <button class="btn">면접관 XLSX</button><button class="btn">평가 인계 XLSX</button><button class="btn">검증 리포트</button>
        </div>
      </div>

      <div class="panel">
        <div class="upload">
          <div><h2>전형 종료</h2><p style="font-size:12.5px; color:var(--muted); margin:4px 0 0">종료 후에는 읽기 전용이 됩니다. 다시 열 수 있습니다.</p></div>
          <button class="btn pri">전형 종료</button>
        </div>
      </div>

      <div class="panel">
        <div class="head"><h2>면접위원 평가 취합</h2>
          <div class="row"><button class="btn sm">평가 인계 XLSX</button><button class="btn sm pri">평가 마감</button></div>
        </div>
        <div class="row" style="margin-bottom:10px"><span class="chip"><span class="dot half"></span>제출 <b>21 / 24</b></span><span class="chip">미제출 위원 2명</span></div>
        <div class="tblwrap"><table>
          <thead><tr><th>지원자</th><th>팀</th><th>종합 평균</th><th>추천</th><th>제출</th></tr></thead>
          <tbody>
            <tr><td>지원자 087</td><td>AI솔루션팀</td><td>4.3</td><td>추천 2</td><td>2/2</td></tr>
            <tr><td>지원자 041</td><td>로봇응용, 전극</td><td>4.0</td><td>추천 3, 보류 1</td><td>4/4</td></tr>
          </tbody>
        </table></div>
        <p class="more">외 58명이 있습니다. 마감하면 위원 입력이 잠기고 인계 파일이 확정됩니다.</p>
      </div>

      <div class="panel">
        <div class="head"><h2>면접위원 참여 이력</h2><span class="sub">평균 5, 최대 8, 최소 2</span></div>
        <div class="tblwrap"><table>
          <thead><tr><th>면접위원</th><th>이번 전형</th><th>누적</th><th></th></tr></thead>
          <tbody>
            <tr><td>이위원 (AI솔루션팀)</td><td>8건</td><td>21건</td><td><span class="chip"><span class="dot half"></span>쏠림</span></td></tr>
            <tr><td>최위원 (로봇응용기술팀)</td><td>5건</td><td>12건</td><td></td></tr>
          </tbody>
        </table></div>
      </div>
`,

  't-pick': `
      <h1>면접 희망자 선택</h1>
      <p class="caption">HR이 전달한 지원자 중 전극기술팀이 면접할 희망자를 고르고 면접관을 지정합니다.</p>

      <div class="panel">
        <div class="row" style="gap:8px">
          <span class="chip">전달 <b>60명</b></span>
          <span class="chip">내 팀 신청 <b>14건</b></span>
          <span class="chip"><span class="dot half"></span>마감 8/12 (D-2)</span>
          <span class="chip">블라인드 적용으로 이름 대신 지원자 번호가 보입니다</span>
        </div>
      </div>

      <div class="panel">
        <div class="head"><h2>지원자 목록</h2>
          <div class="row">
            <div class="field"><input placeholder="검색" style="width:130px"></div>
            <div class="field"><select><option>최종 학력</option></select></div>
            <div class="field"><select><option>지원 분야</option></select></div>
            <div class="field"><select><option>신청 상태</option></select></div>
          </div>
        </div>
        <p class="more" style="margin:0 0 10px">우리 팀의 직무, 전공, R&amp;D 여부와 맞는 추천 지원자가 목록 상단에 먼저 표시됩니다.</p>
        <div class="tblwrap"><table>
          <thead><tr><th>지원자</th><th>학력, 전공</th><th>지원 분야</th><th>수상, 자격</th><th>신청 상태</th><th></th></tr></thead>
          <tbody>
            <tr><td>지원자 233 <span class="reco">추천</span><div style="font-size:11.5px; color:var(--muted)">직무 일치, 전공 일치</div></td><td>석사, 전기화학</td><td>R&amp;D</td><td>3건</td><td><span class="chip"><span class="dot off"></span>미신청</span></td><td><button class="btn sm">신청</button></td></tr>
            <tr><td>지원자 310 <span class="reco">추천</span><div style="font-size:11.5px; color:var(--muted)">직무 일치, 전공 인접</div></td><td>학사, 재료공학</td><td>R&amp;D</td><td>1건</td><td><span class="chip"><span class="dot off"></span>미신청</span></td><td><button class="btn sm">신청</button></td></tr>
            <tr><td>지원자 041</td><td>석사, 로보틱스</td><td>R&amp;D</td><td>2건</td><td><span class="chip"><span class="dot"></span>신청됨 (박팀장)</span></td><td><button class="btn sm">수정</button></td></tr>
            <tr><td>지원자 208</td><td>학사, 재료공학</td><td>R&amp;D</td><td>1건</td><td><span class="chip"><span class="dot"></span>신청됨 (박팀장)</span></td><td><button class="btn sm">수정</button></td></tr>
            <tr><td>지원자 155</td><td>학사, 화학공학</td><td>R&amp;D</td><td>없음</td><td><span class="chip"><span class="dot off"></span>미신청</span></td><td><button class="btn sm">신청</button></td></tr>
          </tbody>
        </table></div>
        <p class="more">외 55명, 1 / 4 페이지입니다. 회피 관계로 신고된 지원자는 추천에서 제외됩니다.</p>
      </div>

      <div class="panel">
        <div class="upload">
          <div><h2>선택 완료</h2><p style="font-size:12.5px; color:var(--muted); margin:4px 0 0">완료하면 HR 취합에 「완료」로 표시됩니다. 마감 전에는 다시 열 수 있습니다.</p></div>
          <button class="btn pri">희망자 선택 완료</button>
        </div>
      </div>
`,

  't-avail': `
      <h1>면접위원 불가 시간</h1>
      <p class="caption">전극기술팀 면접위원의 불가 시간을 등록합니다. 등록한 시간은 편성이 피해 갑니다.</p>

      <div class="panel">
        <div class="head"><h2>우리 팀 면접위원 3명</h2><button class="btn sm pri">+ 불가 시간 등록</button></div>
        <div class="tblwrap"><table>
          <thead><tr><th>면접위원</th><th>가용 창</th><th>불가 시간</th></tr></thead>
          <tbody>
            <tr><td>박팀장</td><td>3창</td><td>8/18 종일</td></tr>
            <tr><td>정위원</td><td>2창</td><td>8/17 09:00~12:00</td></tr>
            <tr><td>한위원</td><td>미입력</td><td>없음</td></tr>
          </tbody>
        </table></div>
        <p class="more">등록 폼은 「+ 불가 시간 등록」을 눌렀을 때만 열립니다.</p>
      </div>
`,

  't-avoid': `
      <h1>회피 관계 신고</h1>
      <p class="caption">지도 관계, 친족, 지인처럼 이해관계가 있는 지원자를 등록합니다. 매칭이 그 짝을 피합니다.</p>

      <div class="panel">
        <div class="head"><h2>신고 1건</h2><button class="btn sm pri">+ 회피 관계 신고</button></div>
        <div class="tblwrap"><table>
          <thead><tr><th>면접위원</th><th>지원자</th><th>사유</th><th>등록</th></tr></thead>
          <tbody>
            <tr><td>박팀장</td><td>지원자 155</td><td>대학원 지도 관계</td><td><span class="chip">본인 신고</span></td></tr>
          </tbody>
        </table></div>
      </div>
`,

  't-sched': `
      <h1>우리 팀 면접 일정</h1>
      <p class="caption">전극기술팀이 참여하는 면접과 연속 입장 블록을 확인합니다. 블록 동안 같은 면접방에 머뭅니다.</p>

      <div class="cards">
        <div class="stat"><div class="k">전체 면접</div><div class="v">14<small>건</small></div></div>
        <div class="stat"><div class="k">주관 면접</div><div class="v">12<small>건</small></div></div>
        <div class="stat"><div class="k">합동 참여</div><div class="v">2<small>건</small></div></div>
        <div class="stat"><div class="k">입장 블록</div><div class="v">4</div></div>
      </div>

      <div class="panel">
        <div class="head"><h2>입장 블록</h2><span class="sub">블록 동안 같은 면접방을 유지합니다</span></div>
        <div class="tblwrap"><table>
          <thead><tr><th>날짜</th><th>조</th><th>시간</th><th>면접관</th><th></th></tr></thead>
          <tbody>
            <tr><td>8/17(월)</td><td>1조</td><td>09:30~11:30</td><td>박팀장, 정위원</td><td><button class="btn sm">Webex 입장</button></td></tr>
            <tr><td>8/18(화)</td><td>2조</td><td>13:00~15:00</td><td>박팀장, 한위원</td><td><button class="btn sm">Webex 입장</button></td></tr>
          </tbody>
        </table></div>
        <p class="more">외 2블록이 있습니다.</p>
      </div>

      <div class="panel">
        <div class="head"><h2>전체 시간표</h2><span class="sub">우리 팀 외 일정은 흐리게 보입니다</span></div>
        <div class="tblwrap">
          <div class="grid">
            <div></div><div class="hd">1조</div><div class="hd">2조</div><div class="hd">3조</div><div class="hd">4조</div>
            <div class="tm">09:30</div>
            <div class="cell joint"><div class="who">지원자 041</div><div class="team">우리 팀 합동</div></div>
            <div class="cell dim"><div class="who">지원자 112</div><div class="team">타 팀</div></div>
            <div class="cell dim"><div class="who">지원자 208</div><div class="team">타 팀</div></div>
            <div class="cell dim"><div class="who">지원자 190</div><div class="team">타 팀</div></div>
          </div>
        </div>
      </div>
`,

  'i-sched': `
      <h1>나의 면접 일정</h1>
      <p class="caption">이위원님에게 배정된 면접과 입장 블록을 확인합니다.</p>

      <div class="cards">
        <div class="stat"><div class="k">전체 배정</div><div class="v">8<small>건</small></div></div>
        <div class="stat"><div class="k">면접일</div><div class="v">2<small>일</small></div></div>
        <div class="stat"><div class="k">입장 블록</div><div class="v">3</div></div>
      </div>

      <div class="panel">
        <div class="tblwrap"><table>
          <thead><tr><th>날짜</th><th>시간</th><th>조</th><th>건수</th><th></th></tr></thead>
          <tbody>
            <tr><td>8/17(월)</td><td>09:00~11:00</td><td>2조</td><td>4건</td><td><button class="btn sm">Webex 입장</button></td></tr>
            <tr><td>8/17(월)</td><td>13:30~14:30</td><td>2조</td><td>2건</td><td><button class="btn sm">Webex 입장</button></td></tr>
            <tr><td>8/19(수)</td><td>10:00~11:00</td><td>1조</td><td>2건</td><td><button class="btn sm">Webex 입장</button></td></tr>
          </tbody>
        </table></div>
      </div>
`,

  'i-work': `
      <h1>면접 진행 워크스페이스</h1>
      <p class="caption">오늘 맡은 면접을 고르면 지원자 정보, 질문 초안, 노트, 평가가 한 화면에 열립니다.</p>

      <div class="ws">
        <div>
          <div class="wslabel">오늘의 면접 3건</div>
          <button class="mtg" aria-current="true"><b>09:00 지원자 087</b><span>2조, AI솔루션팀</span></button>
          <button class="mtg"><b>09:30 지원자 112</b><span>2조, 합동 (미래혁신)</span></button>
          <button class="mtg"><b>10:00 지원자 134</b><span>2조, AI솔루션팀</span></button>
        </div>

        <div>
          <div class="panel">
            <div class="head"><h2>지원자 087</h2>
              <div class="row"><span class="chip">학사</span><button class="btn sm">접속 정보 복사</button><button class="btn sm pri">면접방 입장</button></div>
            </div>
            <dl class="info">
              <dt>전공</dt><dd>전자공학</dd>
              <dt>지원 직무</dt><dd>R&amp;D, AI 응용</dd>
              <dt>수상, 자격</dt><dd>교내 AI 경진 대상 외 1건</dd>
            </dl>
            <p class="more">생년월일, 성별, 국적, 병역, 학점, 어학은 이 화면에 표시하지 않습니다.</p>
          </div>

          <div class="panel">
            <div class="head"><h2>질문 초안</h2><button class="btn sm">초안 생성</button></div>
            <p style="font-size:12.5px; color:var(--muted); margin:0">전공, 학력, 지원 직무만 사용해 생성합니다.</p>
          </div>

          <div class="panel">
            <div class="head"><h2>평가와 면접 노트</h2><span class="sub">5개 기준, 5점 척도, 기본값 없음</span></div>
            <div class="score"><span class="lbl">직무 역량</span><span class="pts"><span class="pt">1</span><span class="pt">2</span><span class="pt">3</span><span class="pt on">4</span><span class="pt">5</span></span></div>
            <div class="score"><span class="lbl">문제 해결</span><span class="pts"><span class="pt">1</span><span class="pt">2</span><span class="pt">3</span><span class="pt on">4</span><span class="pt">5</span></span></div>
            <div class="score"><span class="lbl">커뮤니케이션</span><span class="pts"><span class="pt">1</span><span class="pt">2</span><span class="pt">3</span><span class="pt">4</span><span class="pt on">5</span></span></div>
            <div class="score"><span class="lbl">조직 적합</span><span class="pts"><span class="pt">1</span><span class="pt">2</span><span class="pt">3</span><span class="pt">4</span><span class="pt">5</span></span></div>
            <div class="score"><span class="lbl">종합</span><span class="pts"><span class="pt">1</span><span class="pt">2</span><span class="pt">3</span><span class="pt">4</span><span class="pt">5</span></span></div>
            <div class="row" style="margin-top:12px">
              <div class="field"><label>추천</label><select style="width:100px"><option>선택</option></select></div>
              <div class="field"><label>MBTI</label><input placeholder="예: INFP" style="width:80px"></div>
              <div class="field" style="flex:1"><input placeholder="면접 노트, 코멘트" style="width:100%"></div>
              <button class="btn sm pri">저장</button>
            </div>
            <p class="more">MBTI는 지원서로 수집하지 않으므로 면접에서 확인한 경우에만 노트에 기록합니다.</p>
          </div>
        </div>
      </div>
`,

  'i-evals': `
      <h1>평가 제출 현황</h1>
      <p class="caption">내가 맡은 면접의 평가 제출 상태를 확인합니다.</p>

      <div class="panel">
        <div class="head"><h2>제출 5 / 8</h2><span class="sub">마감 전에는 수정할 수 있습니다</span></div>
        <div class="tblwrap"><table>
          <thead><tr><th>일시</th><th>지원자</th><th>상태</th><th></th></tr></thead>
          <tbody>
            <tr><td>8/17 09:00</td><td>지원자 087</td><td><span class="chip"><span class="dot"></span>제출됨</span></td><td><button class="btn sm">수정</button></td></tr>
            <tr><td>8/17 09:30</td><td>지원자 112</td><td><span class="chip"><span class="dot off"></span>미제출</span></td><td><button class="btn sm">작성</button></td></tr>
          </tbody>
        </table></div>
        <p class="more">외 6건이 있습니다.</p>
      </div>
`,

  'a-guide': `
      <h1>나의 면접 안내</h1>
      <p class="caption">이서아님의 면접 일정을 확인하고 면접방에 입장합니다. 다른 지원자의 정보는 보이지 않습니다.</p>

      <div class="panel">
        <div class="row" style="margin-bottom:12px"><span class="chip"><span class="dot"></span>면접 일정 확정</span></div>
        <div class="cards" style="margin:0">
          <div class="stat"><div class="k">면접 날짜</div><div class="v" style="font-size:16px">8/17(월)</div></div>
          <div class="stat"><div class="k">면접 시간</div><div class="v" style="font-size:16px">09:00~09:25</div></div>
          <div class="stat"><div class="k">면접 조</div><div class="v" style="font-size:16px">2조</div></div>
          <div class="stat"><div class="k">참여 팀</div><div class="v" style="font-size:16px">AI솔루션팀</div></div>
        </div>
      </div>

      <div class="panel">
        <div class="upload">
          <div><h2>온라인 면접방</h2><p style="font-size:12.5px; color:var(--muted); margin:4px 0 0">시작 10분 전까지 입장해 주시기 바랍니다. 입장 링크는 면접 당일에도 이 화면에서 열 수 있습니다.</p></div>
          <button class="btn pri">면접방 입장</button>
        </div>
      </div>

      <div class="panel">
        <div class="head"><h2>면접 전 확인</h2></div>
        <ul style="margin:0; padding-left:18px; font-size:13px; color:var(--muted); line-height:1.9">
          <li>카메라와 마이크가 잘 작동하는지 미리 확인해 주시기 바랍니다.</li>
          <li>조용하고 밝은 장소에서 접속해 주시기 바랍니다.</li>
          <li>본인 확인이 가능한 신분증을 준비해 주시기 바랍니다.</li>
        </ul>
      </div>
`,

  'settings': `
      <h1>설정</h1>
      <p class="caption">진행 흐름 밖의 관리 항목을 한 곳에 모았습니다.</p>

      <div class="hub">
        <div class="hubtabs">
          <button class="hubtab" data-tab="roster" aria-current="true">면접위원 명부</button>
          <button class="hubtab" data-tab="match">면접위원 매칭 제안</button>
          <button class="hubtab" data-tab="events">전형 관리</button>
          <button class="hubtab" data-tab="appearance">화면 설정</button>
          <button class="hubtab" data-tab="help">도움말</button>
        </div>

        <div>
          <div class="hubpane" id="tab-roster">
            <div class="panel">
              <div class="head"><h2>면접위원 24명</h2>
                <div class="row"><button class="btn sm">회신 파일에서 가져오기</button><button class="btn sm">CSV</button><button class="btn sm pri">+ 위원 등록</button></div>
              </div>
              <div class="tblwrap"><table>
                <thead><tr><th>이름</th><th>소속팀</th><th>담당 직무, 전공</th><th>불가</th><th>이번 편성</th></tr></thead>
                <tbody>
                  <tr><td>이위원</td><td>AI솔루션팀</td><td>R&amp;D, AI/ML</td><td>1건</td><td>8건</td></tr>
                  <tr><td>최위원</td><td>로봇응용기술팀</td><td>R&amp;D, 로보틱스</td><td>0건</td><td>5건</td></tr>
                  <tr><td>박팀장</td><td>전극기술팀</td><td>R&amp;D, 재료공학</td><td>2건</td><td>4건</td></tr>
                </tbody>
              </table></div>
              <p class="more">등록 폼은 「+ 위원 등록」을 눌렀을 때만 열립니다.</p>
            </div>
            <details class="fold"><summary>회피 관계<span class="badge">3건</span></summary>
              <div class="fold-body">이해관계가 있는 위원과 지원자 짝입니다. 매칭 제안이 이 목록을 피합니다.</div>
            </details>
            <details class="fold"><summary>등록된 불가 시간<span class="badge">5건</span></summary>
              <div class="fold-body">편성이 이 자리를 피합니다. 팀 담당자 신고분을 포함합니다.</div>
            </details>
          </div>

          <div class="hubpane" id="tab-match" hidden>
            <div class="panel">
              <div class="upload">
                <span class="chip">제안 <b>12건</b>, 세션 32곳 중</span>
                <div class="row"><button class="btn">제안 만들기</button><button class="btn pri">제안 적용</button></div>
              </div>
              <p class="more">직무 +3, 전공 +2, 부하 −1/세션, 담당자 +1, MBTI 상보 +1, 제외 규칙 M1~M4를 적용합니다. MBTI 상보는 면접 노트에 기록된 지원자 MBTI가 있을 때만 적용됩니다. 적용 전에는 시간표에 반영되지 않습니다.</p>
            </div>
            <div class="panel">
              <div class="tblwrap"><table>
                <thead><tr><th>세션</th><th>제안 위원</th><th>MBTI</th><th>점수</th><th>근거</th></tr></thead>
                <tbody>
                  <tr><td>1일차 09:30 2조</td><td>이위원</td><td>ENTJ</td><td>+6</td><td>직무 일치, 전공 인접, MBTI 상보(노트 기록 INFP), 부하 여유</td></tr>
                  <tr><td>1일차 10:00 1조</td><td>최위원</td><td>ISTP</td><td>+4</td><td>직무 일치, 담당자</td></tr>
                </tbody>
              </table></div>
              <p class="more">외 10건이 있습니다.</p>
            </div>
          </div>

          <div class="hubpane" id="tab-events" hidden>
            <div class="panel">
              <div class="head"><h2>전형 3개</h2><button class="btn sm pri">+ 전형 만들기</button></div>
              <div class="tblwrap"><table>
                <thead><tr><th>이름</th><th>상태</th><th>기간</th><th></th></tr></thead>
                <tbody>
                  <tr><td>2026 하반기 신입 2차 직무면접</td><td><span class="chip"><span class="dot half"></span>진행중</span></td><td>8/17~8/19</td><td><span class="chip">보는 중</span></td></tr>
                  <tr><td>2026 상반기 신입 2차 직무면접</td><td><span class="chip"><span class="dot"></span>완료</span></td><td>2/09~2/11</td><td><button class="btn sm">복제</button></td></tr>
                </tbody>
              </table></div>
              <p class="more">생성 폼은 「+ 전형 만들기」로 접습니다. 복제하면 직전 전형의 편성 설정이 넘어옵니다.</p>
            </div>
          </div>

          <div class="hubpane" id="tab-appearance" hidden>
            <div class="panel">
              <div class="head"><h2>사이드바 색</h2></div>
              <div class="row">
                <button class="sideopt" data-side="white" aria-pressed="false"><span class="sw2" style="background:#FFFFFF"></span>화이트</button>
                <button class="sideopt" data-side="red" aria-pressed="true"><span class="sw2" style="background:#A50034"></span>레드</button>
                <button class="sideopt" data-side="black" aria-pressed="false"><span class="sw2" style="background:#232021"></span>블랙</button>
              </div>
              <p class="more">선택은 이 브라우저에 저장됩니다.</p>
            </div>
          </div>

          <div class="hubpane" id="tab-help" hidden>
            <div class="actioncards" style="grid-template-columns:1fr 1fr">
              <div class="action"><h2>화면 안내 투어</h2><p>단계별 하이라이트를 보여줍니다. 자동으로 뜨지 않고 여기서만 시작합니다.</p><button class="btn sm">시작</button></div>
              <div class="action"><h2>영상 안내</h2><p>화면별 시연 영상을 보여줍니다.</p><button class="btn sm">보기</button></div>
            </div>
            <p class="more">궁금한 점은 우측 하단 도움말 챗봇에 바로 물어볼 수 있습니다.</p>
          </div>
        </div>
      </div>
`,
}
